import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as http from 'http';
import * as https from 'https';
import { v4 as uuidv4 } from 'uuid';

import { WebsocketGateway } from '../websocket/websocket.gateway';
import { VoiceIvrRecord } from './entities/voice-ivr-record.entity';
import { VoiceIvrSummary } from './entities/voice-ivr-summary.entity';
import { VoiceOpRecord } from './entities/voice-op-record.entity';
import { VoiceOpSummary } from './entities/voice-op-summary.entity';
import {
  VoiceCrawlState,
  CrawlStateStatus,
} from './entities/voice-crawl-state.entity';
import {
  ensurePageIdParam,
  extractMid,
  resolveStrategy,
} from './strategies/registry';
import {
  ParsedRowVoiceIvr,
  ParsedRowVoiceOp,
  ParsedSummaryVoiceIvr,
  ParsedSummaryVoiceOp,
  VoiceModule,
  VoiceTableStrategy,
} from './strategies/strategy.types';

const THROTTLE_MS = 5 * 60 * 1000;
const PAGE_DELAY_MS = 200;
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 30000;
const MIN_DETAIL_PAGES_PER_RUN = 10;

type Headers = Record<string, string>;

export interface CrawlStartResult {
  success: boolean;
  module?: VoiceModule;
  mid?: number;
  taskId?: string;
  totalPages?: number;
  pagesToFetch?: number;
  message?: string;
  throttled?: boolean;
  retryAfterMs?: number;
  busy?: boolean;
}

@Injectable()
export class VoiceTableService {
  private readonly logger = new Logger(VoiceTableService.name);

  /** key: `${module}:${mid}` -> last successful start timestamp */
  private throttleMap = new Map<string, number>();
  /** key: `${module}:${mid}` -> active flag */
  private activeMap = new Map<string, boolean>();

  constructor(
    @InjectRepository(VoiceIvrRecord)
    private readonly ivrRecordRepo: Repository<VoiceIvrRecord>,
    @InjectRepository(VoiceIvrSummary)
    private readonly ivrSummaryRepo: Repository<VoiceIvrSummary>,
    @InjectRepository(VoiceOpRecord)
    private readonly opRecordRepo: Repository<VoiceOpRecord>,
    @InjectRepository(VoiceOpSummary)
    private readonly opSummaryRepo: Repository<VoiceOpSummary>,
    @InjectRepository(VoiceCrawlState)
    private readonly crawlStateRepo: Repository<VoiceCrawlState>,
    private readonly ws: WebsocketGateway,
  ) {}

  async startCrawl(input: {
    url: string;
    headers?: Headers | Array<{ name: string; value: string }>;
  }): Promise<CrawlStartResult> {
    const strategy = resolveStrategy(input.url);
    if (!strategy) {
      return { success: false, message: `unsupported url: ${input.url}` };
    }
    const mid = extractMid(input.url);
    if (mid == null) {
      return { success: false, message: 'mid query param missing' };
    }

    const key = `${strategy.module}:${mid}`;
    const now = Date.now();

    const headers = this.normalizeHeaders(input.headers);
    const taskId = uuidv4();

    // 抓第 1 页(同步,以便返回 totalPages)
    const firstUrl = ensurePageIdParam(input.url, 1);
    let firstHtml: string;
    try {
      firstHtml = await this.fetchHtml(firstUrl, headers);
    } catch (err: any) {
      this.logger.error(`首页抓取失败 ${key}: ${err.message}`);
      this.ws.broadcastVoiceTableProgress({
        module: strategy.module,
        mid,
        taskId,
        page: 1,
        pagesToFetch: 0,
        status: 'failed',
        error: `fetch first page failed: ${err.message}`,
      });
      return {
        success: false,
        message: `fetch first page failed: ${err.message}`,
      };
    }

    const firstParsed = strategy.parse(firstHtml);
    const newTotalPages = firstParsed.totalPages || 1;
    this.logger.log(
      `首页解析 ${key}: html=${firstHtml.length}b rows=${firstParsed.rows.length} totalPages=${newTotalPages}`,
    );

    // 加载持久化的抓取状态，判断是否断点续抓
    const crawlState = await this.crawlStateRepo.findOne({
      where: { module: strategy.module, mid },
    });
    const isIncomplete =
      crawlState &&
      crawlState.status !== 'completed' &&
      crawlState.lastCompletedPage > 0;

    let pagesToFetch: number;
    let resumeFromPage: number;

    if (isIncomplete) {
      // 上次中断：从上次完成页的下一页续抓，以最新 totalPages 为终点
      resumeFromPage = crawlState.lastCompletedPage + 1;
      pagesToFetch = Math.max(crawlState.totalPages, newTotalPages);
      this.logger.log(
        `断点续抓 ${key}: 从第 ${resumeFromPage} 页开始, 目标共 ${pagesToFetch} 页`,
      );
    } else {
      // 正常增量抓取
      resumeFromPage = 2;
      const lastTotalPages = await this.getLastTotalPages(strategy.module, mid);
      if (lastTotalPages == null || newTotalPages < lastTotalPages) {
        pagesToFetch = newTotalPages;
      } else {
        pagesToFetch = Math.max(
          MIN_DETAIL_PAGES_PER_RUN,
          newTotalPages - lastTotalPages + 1,
        );
      }
      pagesToFetch = Math.min(pagesToFetch, newTotalPages);
    }

    const detailBusy = this.activeMap.get(key) === true;
    const lastDetailStart = this.throttleMap.get(key) ?? 0;
    const detailRetryAfterMs = Math.max(
      0,
      THROTTLE_MS - (now - lastDetailStart),
    );
    // 有未完成页时跳过节流，确保能续抓
    const detailThrottled = !isIncomplete && detailRetryAfterMs > 0;

    // 写入第一页行 + WS 推送
    const insertedFirst = await this.persistRows(
      strategy.module,
      mid,
      input.url,
      firstParsed.rows,
    );
    if (insertedFirst.length > 0) {
      this.ws.broadcastVoiceTableRows({
        module: strategy.module,
        mid,
        page: 1,
        rows: insertedFirst,
        taskId,
        timestamp: new Date().toISOString(),
      });
    }
    this.ws.broadcastVoiceTableProgress({
      module: strategy.module,
      mid,
      taskId,
      page: 1,
      pagesToFetch,
      status:
        detailBusy || detailThrottled || pagesToFetch === 1
          ? 'completed'
          : 'running',
    });

    const capturedAt = new Date();
    await this.persistSummary(
      strategy,
      mid,
      input.url,
      firstParsed.summary,
      firstParsed.summaryMatched,
      newTotalPages,
      pagesToFetch,
      capturedAt,
      taskId,
    );

    // 更新抓取状态：标记 running，第 1 页已完成
    await this.upsertCrawlState(strategy.module, mid, {
      totalPages: pagesToFetch,
      lastCompletedPage: isIncomplete
        ? crawlState.lastCompletedPage
        : Math.min(1, pagesToFetch),
      status: 'running',
    });

    if (detailBusy) {
      this.logger.log(`明细任务运行中, 仅刷新 summary ${key}`);
      return {
        success: true,
        module: strategy.module,
        mid,
        taskId,
        totalPages: newTotalPages,
        pagesToFetch,
        busy: true,
        message: 'summary 已刷新，明细后台任务仍在运行',
      };
    }

    if (detailThrottled) {
      this.logger.log(
        `明细节流命中 ${key}, 仅刷新 summary, 剩余 ${Math.ceil(
          detailRetryAfterMs / 1000,
        )}s`,
      );
      await this.upsertCrawlState(strategy.module, mid, { status: 'failed' });
      return {
        success: true,
        module: strategy.module,
        mid,
        taskId,
        totalPages: newTotalPages,
        pagesToFetch,
        retryAfterMs: detailRetryAfterMs,
        message: 'summary 已刷新，明细后台任务受节流未启动',
      };
    }

    // 第 resumeFromPage..pagesToFetch 页异步循环
    if (resumeFromPage <= pagesToFetch) {
      this.throttleMap.set(key, now);
      this.activeMap.set(key, true);
      void this.runRemainingPages({
        strategy,
        mid,
        baseUrl: input.url,
        headers,
        pagesToFetch,
        resumeFromPage,
        taskId,
        key,
      })
        .catch((err) => {
          this.logger.error(`后台抓取异常 ${key}: ${err.message}`);
        })
        .finally(() => {
          this.activeMap.delete(key);
        });
    } else {
      // 没有后续页需要抓（resumeFromPage > pagesToFetch 说明已全部完成）
      await this.upsertCrawlState(strategy.module, mid, {
        status: 'completed',
        lastCompletedPage: pagesToFetch,
      });
    }

    return {
      success: true,
      module: strategy.module,
      mid,
      taskId,
      totalPages: newTotalPages,
      pagesToFetch,
    };
  }

  // ============================ 内部 ============================

  private async runRemainingPages(args: {
    strategy: VoiceTableStrategy;
    mid: number;
    baseUrl: string;
    headers: Headers;
    pagesToFetch: number;
    /** 从哪页开始（断点续抓时 > 2） */
    resumeFromPage: number;
    taskId: string;
    key: string;
  }): Promise<void> {
    const {
      strategy,
      mid,
      baseUrl,
      headers,
      pagesToFetch,
      resumeFromPage,
      taskId,
      key,
    } = args;
    const failedPages: Array<{ page: number; error: string }> = [];

    for (let page = resumeFromPage; page <= pagesToFetch; page++) {
      try {
        await this.crawlPage({
          strategy,
          mid,
          baseUrl,
          headers,
          page,
          pagesToFetch,
          taskId,
        });
        // 每页完成后持久化进度
        await this.upsertCrawlState(strategy.module, mid, {
          lastCompletedPage: page,
          status: page < pagesToFetch ? 'running' : 'completed',
        });
      } catch (err: any) {
        const message = err.message || String(err);
        failedPages.push({ page, error: message });
        this.logger.warn(`抓取 page=${page} 失败, 稍后重试 ${key}: ${message}`);
        this.ws.broadcastVoiceTableProgress({
          module: strategy.module,
          mid,
          taskId,
          page,
          pagesToFetch,
          status: 'failed',
          error: `${message}; queued for retry`,
        });
      }

      if (page < pagesToFetch) {
        await sleep(PAGE_DELAY_MS);
      }
    }

    for (const failed of failedPages) {
      try {
        this.logger.log(`补抓 page=${failed.page} ${key}`);
        await this.crawlPage({
          strategy,
          mid,
          baseUrl,
          headers,
          page: failed.page,
          pagesToFetch,
          taskId,
        });
        await this.upsertCrawlState(strategy.module, mid, {
          lastCompletedPage: failed.page,
        });
      } catch (err: any) {
        const message = err.message || String(err);
        this.logger.error(`补抓 page=${failed.page} 失败 ${key}: ${message}`);
        this.ws.broadcastVoiceTableProgress({
          module: strategy.module,
          mid,
          taskId,
          page: failed.page,
          pagesToFetch,
          status: 'failed',
          error: message,
        });
      }
    }

    // 补抓完成后标记整体状态
    await this.upsertCrawlState(strategy.module, mid, { status: 'completed' });
  }

  private async crawlPage(args: {
    strategy: VoiceTableStrategy;
    mid: number;
    baseUrl: string;
    headers: Headers;
    page: number;
    pagesToFetch: number;
    taskId: string;
  }): Promise<void> {
    const { strategy, mid, baseUrl, headers, page, pagesToFetch, taskId } = args;
    const pageUrl = ensurePageIdParam(baseUrl, page);
    const html = await this.fetchHtmlWithRetry(pageUrl, headers);
    const parsed = strategy.parse(html);
    const inserted = await this.persistRows(
      strategy.module,
      mid,
      baseUrl,
      parsed.rows,
    );

    if (inserted.length > 0) {
      this.ws.broadcastVoiceTableRows({
        module: strategy.module,
        mid,
        page,
        rows: inserted,
        taskId,
        timestamp: new Date().toISOString(),
      });
    }

    this.ws.broadcastVoiceTableProgress({
      module: strategy.module,
      mid,
      taskId,
      page,
      pagesToFetch,
      status: page === pagesToFetch ? 'completed' : 'running',
    });
  }

  private async getLastTotalPages(
    module: VoiceModule,
    mid: number,
  ): Promise<number | null> {
    const repo =
      module === 'voice_ivr' ? this.ivrSummaryRepo : this.opSummaryRepo;
    const last = await repo
      .createQueryBuilder('s')
      .where('s.mid = :mid', { mid })
      .andWhere('(s."totalRecords" > 0 OR s."totalPages" > 1)')
      .orderBy('s."capturedAt"', 'DESC')
      .getOne();
    return last ? last.totalPages : null;
  }

  private async persistRows(
    module: VoiceModule,
    mid: number,
    sourceUrl: string,
    rows: ParsedRowVoiceIvr[] | ParsedRowVoiceOp[],
  ): Promise<any[]> {
    if (rows.length === 0) return [];

    if (module === 'voice_ivr') {
      const ivrRows = rows as ParsedRowVoiceIvr[];
      const entities = ivrRows.map((r) => {
        const e = new VoiceIvrRecord();
        e.id = uuidv4();
        e.mid = mid;
        e.recordId = r.recordId;
        e.src = r.src;
        e.dst = r.dst;
        e.statusType = r.statusType;
        e.result = r.result;
        e.reason = r.reason;
        e.task = r.task;
        e.callDate = r.callDate;
        e.sourceUrl = sourceUrl;
        return e;
      });
      const result = await this.ivrRecordRepo
        .createQueryBuilder()
        .insert()
        .into(VoiceIvrRecord)
        .values(entities)
        .orIgnore()
        .returning('*')
        .execute();
      return (result.raw as any[]) ?? [];
    }

    const opRows = rows as ParsedRowVoiceOp[];
    const entities = opRows.map((r) => {
      const e = new VoiceOpRecord();
      e.id = uuidv4();
      e.mid = mid;
      e.recordKey = r.recordKey;
      e.task = r.task;
      e.src = r.src;
      e.dst = r.dst;
      e.agent = r.agent;
      e.reason = r.reason;
      e.duration = r.duration;
      e.callDate = r.callDate;
      e.endDate = r.endDate;
      e.sourceUrl = sourceUrl;
      return e;
    });
    const result = await this.opRecordRepo
      .createQueryBuilder()
      .insert()
      .into(VoiceOpRecord)
      .values(entities)
      .orIgnore()
      .returning('*')
      .execute();
    return (result.raw as any[]) ?? [];
  }

  private async persistSummary(
    strategy: VoiceTableStrategy,
    mid: number,
    sourceUrl: string,
    summary: ParsedSummaryVoiceIvr | ParsedSummaryVoiceOp,
    summaryMatched: boolean,
    totalPages: number,
    pagesToFetch: number,
    capturedAt: Date,
    taskId: string,
  ): Promise<void> {
    if (!summaryMatched) {
      this.logger.warn(
        `跳过无效 summary mid=${mid}: 未匹配到汇总区, 明细行可能已入库但汇总未写入`,
      );
      return;
    }

    if (strategy.module === 'voice_ivr') {
      const s = summary as ParsedSummaryVoiceIvr;
      const last = await this.ivrSummaryRepo.findOne({
        where: { mid },
        order: { capturedAt: 'DESC' },
      });

      if (last && this.isSameIvrSummary(last, s, totalPages)) {
        await this.ivrSummaryRepo.update(last.id, { capturedAt });
        this.logger.debug(
          `summary 未变化, 更新时间 voice_ivr:${mid} -> ${capturedAt.toISOString()}`,
        );
        return;
      }

      const e = new VoiceIvrSummary();
      e.id = uuidv4();
      e.mid = mid;
      e.totalRecords = s.totalRecords;
      e.connectFail = s.connectFail;
      e.busy = s.busy;
      e.noAnswer = s.noAnswer;
      e.connected = s.connected;
      e.totalPages = totalPages;
      e.sourceUrl = sourceUrl;
      e.capturedAt = capturedAt;
      await this.ivrSummaryRepo.save(e);
    } else {
      const s = summary as ParsedSummaryVoiceOp;
      const last = await this.opSummaryRepo.findOne({
        where: { mid },
        order: { capturedAt: 'DESC' },
      });
      const connectRate = s.connectRate.toFixed(2);
      const callbackRate = s.callbackRate.toFixed(2);

      if (
        last &&
        this.isSameOpSummary(last, s, totalPages, connectRate, callbackRate)
      ) {
        await this.opSummaryRepo.update(last.id, { capturedAt });
        this.logger.debug(
          `summary 未变化, 更新时间 voice_op:${mid} -> ${capturedAt.toISOString()}`,
        );
        return;
      }

      const e = new VoiceOpSummary();
      e.id = uuidv4();
      e.mid = mid;
      e.totalRecords = s.totalRecords;
      e.initCount = s.initCount;
      e.ringing = s.ringing;
      e.connected = s.connected;
      e.agentCount = s.agentCount;
      e.connectRate = connectRate;
      e.callbackRate = callbackRate;
      e.totalPages = totalPages;
      e.sourceUrl = sourceUrl;
      e.capturedAt = capturedAt;
      await this.opSummaryRepo.save(e);
    }

    this.ws.broadcastVoiceTableSummary({
      module: strategy.module,
      mid,
      summary,
      totalPages,
      pagesToFetch,
      capturedAt: capturedAt.toISOString(),
      taskId,
    });
  }

  private isSameIvrSummary(
    last: VoiceIvrSummary,
    next: ParsedSummaryVoiceIvr,
    totalPages: number,
  ): boolean {
    return (
      last.totalRecords === next.totalRecords &&
      last.connectFail === next.connectFail &&
      last.busy === next.busy &&
      last.noAnswer === next.noAnswer &&
      last.connected === next.connected &&
      last.totalPages === totalPages
    );
  }

  private isSameOpSummary(
    last: VoiceOpSummary,
    next: ParsedSummaryVoiceOp,
    totalPages: number,
    connectRate: string,
    callbackRate: string,
  ): boolean {
    return (
      last.totalRecords === next.totalRecords &&
      last.initCount === next.initCount &&
      last.ringing === next.ringing &&
      last.connected === next.connected &&
      last.agentCount === next.agentCount &&
      String(last.connectRate) === connectRate &&
      String(last.callbackRate) === callbackRate &&
      last.totalPages === totalPages
    );
  }

  private normalizeHeaders(
    headers?: Headers | Array<{ name: string; value: string }>,
  ): Headers {
    const out: Headers = {};
    if (!headers) return out;
    if (Array.isArray(headers)) {
      for (const h of headers) {
        if (h && h.name) out[h.name] = h.value;
      }
    } else {
      Object.assign(out, headers);
    }
    // 移除与 node http 冲突或会导致乱码的头
    const BLOCKED = new Set(['host', 'content-length', 'accept-encoding']);
    for (const name of Object.keys(out)) {
      if (BLOCKED.has(name.toLowerCase())) delete out[name];
    }
    return out;
  }

  private async fetchHtmlWithRetry(
    url: string,
    headers: Headers,
  ): Promise<string> {
    let lastErr: any;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.fetchHtml(url, headers);
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_RETRIES) {
          await sleep(300 * (attempt + 1));
        }
      }
    }
    throw lastErr;
  }

  private fetchHtml(url: string, headers: Headers): Promise<string> {
    return new Promise((resolve, reject) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch (e: any) {
        reject(new Error(`invalid url: ${url}`));
        return;
      }
      const isHttps = parsed.protocol === 'https:';
      const client = isHttps ? https : http;

      const req = client.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers,
          timeout: REQUEST_TIMEOUT_MS,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf-8');
            if ((res.statusCode ?? 0) >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${url}`));
              return;
            }
            resolve(body);
          });
        },
      );
      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`request timeout: ${url}`));
      });
      req.end();
    });
  }

  /** 插入或更新 VoiceCrawlState（以 module+mid 为 key） */
  private async upsertCrawlState(
    module: string,
    mid: number,
    update: Partial<Pick<VoiceCrawlState, 'totalPages' | 'lastCompletedPage' | 'status'>>,
  ): Promise<void> {
    const existing = await this.crawlStateRepo.findOne({
      where: { module, mid },
    });
    if (existing) {
      await this.crawlStateRepo.update(existing.id, update);
    } else {
      const s = new VoiceCrawlState();
      s.id = uuidv4();
      s.module = module;
      s.mid = mid;
      s.totalPages = update.totalPages ?? 1;
      s.lastCompletedPage = update.lastCompletedPage ?? 0;
      s.status = (update.status ?? 'running') as CrawlStateStatus;
      await this.crawlStateRepo.save(s);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
