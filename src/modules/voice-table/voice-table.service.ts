import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as http from 'http';
import * as https from 'https';
import { fork } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { getHeapStatistics } from 'v8';
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

/** 同一表格（crmKey+module+mid）两次明细抓取的最小间隔，5 分钟内重复触发只写首页 */
const THROTTLE_MS = 5 * 60 * 1000;
/** 翻页间隔，避免对 CRM 请求过于密集 */
const PAGE_DELAY_MS = 200;
/** 表格翻页请求最大并发数（worker 不可用时的主进程兜底路径也使用） */
const TABLE_PAGE_CONCURRENCY = 3;
/** 单页抓取失败后的最大重试次数（实际最多尝试 MAX_RETRIES + 1 次） */
const MAX_RETRIES = 2;
/** 单页 HTTP 请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 30000;
/** 增量抓取时每次至少处理的页数（总页数不变时也会扫这么多页做查重） */
const MIN_DETAIL_PAGES_PER_RUN = 10;
/** 断点续抓时往回重叠的页数，防止页码漂移或末页半完成导致漏数据 */
const RESUME_OVERLAP_PAGES = 2;
/** 明细进度日志输出间隔页数 */
const PROGRESS_LOG_INTERVAL_PAGES = 100;
/** IVR 尾页锚点检测范围：从倒数第 N 页开始比对已知 recordId */
const IVR_TAIL_ANCHOR_PAGES = 2;

/** 单次日常明细扫描最多处理页数；超出部分交由历史补全任务分批续跑，防止单个长循环 OOM */
const VOICE_TABLE_DAILY_MAX_PAGES = 10;
/** 历史补全每批抓取页数 */
const HISTORY_BATCH_SIZE = 50;
/** checkpoint 写库间隔页数，降低高频 DB 往返开销 */
const CHECKPOINT_INTERVAL_PAGES = 50;
/** 堆内存使用率超过此比例时暂停明细扫描，等下一轮再试 */
const MEMORY_PAUSE_HEAP_RATIO = 0.7;
/** 堆内存使用率超过此比例时强制终止 worker 子进程 */
const MEMORY_DANGER_HEAP_RATIO = 0.85;
/** 单页 HTML 响应体大小上限（2MB），超出则拒绝 */
const MAX_VOICE_TABLE_HTML_BYTES = 2 * 1024 * 1024;
/** worker 子进程默认超时（毫秒），超时则 kill */
const DEFAULT_WORKER_TIMEOUT_MS = 5 * 60 * 1000;

type Headers = Record<string, string>;

interface PageRange {
  start: number;
  end: number;
  label: string;
  updateCheckpoint: boolean;
  stopOnDuplicatePage?: boolean;
  stopOnAnchorKeys?: Set<string>;
  initialCompletedDate?: string;
}

interface CrawlPageOutcome {
  insertedCount: number;
  containsAnchor: boolean;
  allRowsDuplicate: boolean;
}

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
  /** key: `${crmKey}:${module}:${mid}` -> true when history batch is running */
  private historyActiveMap = new Map<string, boolean>();

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
    crmKey?: string;
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

    const crmKey = this.normalizeCrmKey(input.crmKey ?? input.url);
    const key = `${crmKey}:${strategy.module}:${mid}`;
    const now = Date.now();

    const headers = this.normalizeHeaders(input.headers);
    const taskId = uuidv4();
    this.logger.warn(
      `[mem-diagnose] voice-table start ${key}: heap=${this.formatHeapUsage()}`,
    );

    const workerStartResult = await this.tryStartCrawlInWorker({
      crmKey,
      strategy,
      mid,
      baseUrl: input.url,
      headers,
      key,
      taskId,
      now,
    });
    if (workerStartResult) return workerStartResult;

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
    this.logger.warn(
      `[mem-diagnose] voice-table first-page ${key}: html=${firstHtml.length} rows=${firstParsed.rows.length} totalPages=${newTotalPages} heap=${this.formatHeapUsage()}`,
    );

    // 加载持久化的抓取状态，判断是否断点续抓
    const crawlState = await this.crawlStateRepo.findOne({
      where: { crmKey, module: strategy.module, mid },
    });
    const hasPendingHistory =
      crawlState?.historyStatus === 'pending' ||
      crawlState?.historyStatus === 'running';
    const isIncomplete =
      crawlState &&
      crawlState.status !== 'completed' &&
      crawlState.lastCompletedPage > 0;

    let pagesToFetch: number;
    let pageRanges: PageRange[];
    let shouldBackfillHistory = false;
    const businessDate = this.getBusinessDate(strategy.module, firstParsed.rows);
    const needsDailyBackfill =
      businessDate != null && crawlState?.initialCompletedDate !== businessDate;

    if (needsDailyBackfill) {
      shouldBackfillHistory = true;
      const tailAnchorKeys =
        strategy.module === 'voice_ivr'
          ? await this.fetchIvrTailAnchorKeys({
              strategy,
              crmKey,
              mid,
              baseUrl: input.url,
              headers,
              totalPages: newTotalPages,
            })
          : new Set<string>();
      // 每日锚点扫描上限：超出页数由历史补全任务分批续跑，避免单次长任务 OOM
      const dailyCap = Math.min(newTotalPages, VOICE_TABLE_DAILY_MAX_PAGES);
      pagesToFetch = dailyCap;
      pageRanges =
        dailyCap >= 2
          ? [
              {
                start: 2,
                end: dailyCap,
                label:
                  strategy.module === 'voice_ivr'
                    ? '每日初始锚点'
                    : '每日初始',
                updateCheckpoint: true,
                stopOnAnchorKeys: tailAnchorKeys,
                initialCompletedDate: businessDate,
              },
            ]
          : [];
      this.logger.log(
        `每日初始 ${key}: date=${businessDate} anchors=${tailAnchorKeys.size} 日常上限 ${dailyCap}/${newTotalPages} 页`,
      );
    } else if (strategy.module === 'voice_ivr') {
      pagesToFetch = Math.min(newTotalPages, VOICE_TABLE_DAILY_MAX_PAGES);
      pageRanges =
        pagesToFetch >= 2
          ? [
              {
                start: 2,
                end: pagesToFetch,
                label: '增量查重',
                updateCheckpoint: false,
                stopOnDuplicatePage: true,
              },
            ]
          : [];
      this.logger.log(
        `IVR 增量查重 ${key}: 从首页向后扫到整页重复, 最大 ${pagesToFetch} 页`,
      );
    } else if (isIncomplete) {
      // 上次中断：先补扫新增页对应的最新区，再从断点前回退少量页续抓。
      pagesToFetch = Math.max(crawlState.totalPages, newTotalPages);
      pageRanges = this.buildResumeRanges({
        lastCompletedPage: crawlState.lastCompletedPage,
        previousTotalPages: crawlState.totalPages,
        pagesToFetch,
      });
      this.logger.log(
        `断点续抓 ${key}: ${this.formatPageRanges(pageRanges)}, 目标共 ${pagesToFetch} 页`,
      );
    } else {
      // 正常增量抓取
      const lastTotalPages = await this.getLastTotalPages(
        crmKey,
        strategy.module,
        mid,
      );
      if (lastTotalPages == null || newTotalPages < lastTotalPages) {
        pagesToFetch = newTotalPages;
        shouldBackfillHistory = true;
      } else {
        pagesToFetch = Math.max(
          MIN_DETAIL_PAGES_PER_RUN,
          newTotalPages - lastTotalPages + 1,
        );
      }
      pagesToFetch = Math.min(
        pagesToFetch,
        newTotalPages,
        VOICE_TABLE_DAILY_MAX_PAGES,
      );
      pageRanges =
        pagesToFetch >= 2
          ? [
              {
                start: 2,
                end: pagesToFetch,
                label: '增量',
                updateCheckpoint: true,
              },
            ]
          : [];
    }

    const detailBusy = this.activeMap.get(key) === true;
    const lastDetailStart = this.throttleMap.get(key) ?? 0;
    const detailRetryAfterMs = Math.max(
      0,
      THROTTLE_MS - (now - lastDetailStart),
    );
    // 有未完成页或每日初始锚点任务时跳过节流，确保能补齐缺口。
    const hasPendingDetail = isIncomplete || needsDailyBackfill;
    const detailThrottled = !hasPendingDetail && detailRetryAfterMs > 0;

    // 写入第一页行 + WS 推送
    const insertedFirst = await this.persistRows(
      strategy.module,
      crmKey,
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
    if (
      strategy.module === 'voice_ivr' &&
      !needsDailyBackfill &&
      firstParsed.rows.length > 0 &&
      insertedFirst.length === 0
    ) {
      pageRanges = [];
      pagesToFetch = 1;
      this.logger.log(`IVR 首页整页重复 ${key}: 本轮增量无需继续翻页`);
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
      crmKey,
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
    await this.upsertCrawlState(crmKey, strategy.module, mid, {
      // 断点续抓完成前保留旧 totalPages，避免补扫最新区中途重启后丢失 delta。
      totalPages:
        isIncomplete && strategy.module !== 'voice_ivr'
          ? crawlState.totalPages
          : newTotalPages,
      lastCompletedPage:
        isIncomplete && strategy.module !== 'voice_ivr'
          ? crawlState.lastCompletedPage
          : Math.min(1, pagesToFetch),
      status: 'running',
      ...(needsDailyBackfill && businessDate
        ? { initialCompletedDate: businessDate }
        : {}),
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
      await this.upsertCrawlState(crmKey, strategy.module, mid, {
        status: 'failed',
      });
      if (
        hasPendingHistory &&
        newTotalPages > VOICE_TABLE_DAILY_MAX_PAGES
      ) {
        void this.scheduleAndRunHistoryBatch({
          strategy,
          crmKey,
          mid,
          baseUrl: input.url,
          headers,
          key,
          totalPagesRef: newTotalPages,
          nextPage: pagesToFetch + 1,
          businessDate: businessDate ?? undefined,
          resetHistoryCursor: shouldBackfillHistory,
        }).catch((err) =>
          this.logger.error(`历史补全调度失败 ${key}: ${err.message}`),
        );
      }
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

    // 后续页异步循环
    if (pageRanges.length > 0) {
      this.throttleMap.set(key, now);
      this.activeMap.set(key, true);
      const runResult = { anchorFound: false };
      void this.runRemainingPages({
        strategy,
        crmKey,
        mid,
        baseUrl: input.url,
        headers,
        pagesToFetch,
        discoveredTotalPages: newTotalPages,
        pageRanges,
        initialLastCompletedPage: isIncomplete
          ? crawlState.lastCompletedPage
          : Math.min(1, pagesToFetch),
        taskId,
        key,
        runResult,
      })
        .catch((err) => {
          this.logger.error(`后台抓取异常 ${key}: ${err.message}`);
        })
        .finally(() => {
          this.activeMap.delete(key);
          // 日常锚点扫描触碰上限且未命中尾页锚点，调度历史补全批次
          if (
            !runResult.anchorFound &&
            newTotalPages > VOICE_TABLE_DAILY_MAX_PAGES &&
            (shouldBackfillHistory || hasPendingHistory)
          ) {
            void this.scheduleAndRunHistoryBatch({
              strategy,
              crmKey,
              mid,
              baseUrl: input.url,
              headers,
              key,
              totalPagesRef: newTotalPages,
              nextPage: pagesToFetch + 1,
              businessDate: businessDate ?? undefined,
              resetHistoryCursor: shouldBackfillHistory,
            }).catch((err) =>
              this.logger.error(`历史补全调度失败 ${key}: ${err.message}`),
            );
          }
        });
    } else {
      // 没有后续页需要抓（resumeFromPage > pagesToFetch 说明已全部完成）
      await this.upsertCrawlState(crmKey, strategy.module, mid, {
        totalPages: newTotalPages,
        status: 'completed',
        lastCompletedPage: pagesToFetch,
        initialCompletedDate: needsDailyBackfill
          ? businessDate
          : crawlState?.initialCompletedDate,
      });
      if (
        hasPendingHistory &&
        newTotalPages > VOICE_TABLE_DAILY_MAX_PAGES
      ) {
        void this.scheduleAndRunHistoryBatch({
          strategy,
          crmKey,
          mid,
          baseUrl: input.url,
          headers,
          key,
          totalPagesRef: newTotalPages,
          nextPage: pagesToFetch + 1,
          businessDate: businessDate ?? undefined,
          resetHistoryCursor: needsDailyBackfill,
        }).catch((err) =>
          this.logger.error(`历史补全调度失败 ${key}: ${err.message}`),
        );
      }
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

  private async tryStartCrawlInWorker(args: {
    crmKey: string;
    strategy: VoiceTableStrategy;
    mid: number;
    baseUrl: string;
    headers: Headers;
    key: string;
    taskId: string;
    now: number;
  }): Promise<CrawlStartResult | null> {
    if (process.env.VOICE_TABLE_WORKER_ENABLED === 'false') return null;

    if (this.activeMap.get(args.key) === true) {
      return {
        success: true,
        module: args.strategy.module,
        mid: args.mid,
        taskId: args.taskId,
        busy: true,
        message: '表格 worker 正在运行',
      };
    }

    const workerPath = this.resolveWorkerPath();
    if (!workerPath) return null;

    this.throttleMap.set(args.key, args.now);
    this.activeMap.set(args.key, true);
    try {
      this.logger.log(`启动表格 start worker ${args.key}`);
      const result = await this.runVoiceTableWorker({
        mode: 'start',
        crmKey: args.crmKey,
        module: args.strategy.module,
        mid: args.mid,
        baseUrl: args.baseUrl,
        headers: args.headers,
      });

      if (!result.success) {
        this.ws.broadcastVoiceTableProgress({
          module: args.strategy.module,
          mid: args.mid,
          taskId: args.taskId,
          page: result.highestCompletedPage || 0,
          pagesToFetch: result.pagesToFetch ?? 0,
          status: 'failed',
          error: result.error,
        });
        return {
          success: false,
          module: args.strategy.module,
          mid: args.mid,
          taskId: args.taskId,
          totalPages: result.totalPages,
          pagesToFetch: result.pagesToFetch,
          message: result.error || 'table worker failed',
        };
      }

      await this.drainHistoryWorkerChain(args);

      this.ws.broadcastVoiceTableProgress({
        module: args.strategy.module,
        mid: args.mid,
        taskId: args.taskId,
        page: result.highestCompletedPage || 1,
        pagesToFetch: result.pagesToFetch ?? 1,
        status: 'completed',
      });

      return {
        success: true,
        module: args.strategy.module,
        mid: args.mid,
        taskId: args.taskId,
        totalPages: result.totalPages,
        pagesToFetch: result.pagesToFetch,
      };
    } catch (err: any) {
      this.logger.error(`表格 worker 启动执行失败 ${args.key}: ${err.message}`);
      return {
        success: false,
        module: args.strategy.module,
        mid: args.mid,
        taskId: args.taskId,
        message: err.message,
      };
    } finally {
      this.activeMap.delete(args.key);
    }
  }

  private async runRemainingPages(args: {
    strategy: VoiceTableStrategy;
    crmKey: string;
    mid: number;
    baseUrl: string;
    headers: Headers;
    pagesToFetch: number;
    discoveredTotalPages: number;
    pageRanges: PageRange[];
    initialLastCompletedPage: number;
    taskId: string;
    key: string;
    /** 回传锚点是否命中，供调用方判断是否需要调度历史补全 */
    runResult?: { anchorFound: boolean };
  }): Promise<void> {
    const {
      strategy,
      crmKey,
      mid,
      baseUrl,
      headers,
      pagesToFetch,
      discoveredTotalPages,
      pageRanges,
      initialLastCompletedPage,
      taskId,
      key,
      runResult,
    } = args;
    const failedPages: Array<{ page: number; error: string }> = [];
    let authAborted = false;
    let highestCompletedPage = initialLastCompletedPage;
    let stoppedByBoundary = false;
    let pausedByMemory = false;
    let completedInitialDate: string | null = null;
    let unresolvedFailedPages = 0;

    const workerHandled = await this.tryRunRemainingPagesInWorker(args);
    if (workerHandled) return;

    for (const range of pageRanges) {
      for (let page = range.start; page <= range.end && !stoppedByBoundary;) {
        if (this.getHeapUsageRatio() >= MEMORY_PAUSE_HEAP_RATIO) {
          pausedByMemory = true;
          this.logger.warn(
            `内存水位过高，暂停明细扫描 ${key}: page=${page}/${pagesToFetch} heap=${this.formatHeapUsage()}`,
          );
          await this.upsertCrawlState(crmKey, strategy.module, mid, {
            totalPages: discoveredTotalPages,
            lastCompletedPage: highestCompletedPage,
            status: 'running',
          });
          break;
        }

        const bulkMode = this.isBulkPageRange(strategy.module, range);
        const pages: number[] = [];
        while (page <= range.end && pages.length < TABLE_PAGE_CONCURRENCY) {
          pages.push(page);
          page++;
        }

        const results = await Promise.all(
          pages.map(async (currentPage) => {
            try {
              const outcome = await this.crawlPage({
                strategy,
                crmKey,
                mid,
                baseUrl,
                headers,
                page: currentPage,
                pagesToFetch,
                taskId,
                anchorKeys: range.stopOnAnchorKeys,
                isHistoryMode: bulkMode,
              });
              return { page: currentPage, outcome };
            } catch (error) {
              return { page: currentPage, error };
            }
          }),
        );

        results.sort((a, b) => a.page - b.page);

        for (const result of results) {
          if ('error' in result) {
            const message =
              result.error instanceof Error
                ? result.error.message
                : String(result.error);

            // 401/403 = Cookie 已失效，立刻中止，不继续也不补抓
            if (this.isAuthError(message)) {
              this.logger.warn(
                `Cookie 失效（${message}），中止后续抓取 ${key}，等待重新登录`,
              );
              this.ws.broadcastVoiceTableProgress({
                module: strategy.module,
                mid,
                taskId,
                page: result.page,
                pagesToFetch,
                status: 'failed',
                error: `Cookie 失效，已中止: ${message}`,
              });
              await this.upsertCrawlState(crmKey, strategy.module, mid, {
                status: 'failed',
              });
              authAborted = true;
              break;
            }

            failedPages.push({ page: result.page, error: message });
            this.logger.warn(
              `抓取 page=${result.page} 失败, 稍后重试 ${key}: ${message}`,
            );
            this.ws.broadcastVoiceTableProgress({
              module: strategy.module,
              mid,
              taskId,
              page: result.page,
              pagesToFetch,
              status: 'failed',
              error: `${message}; queued for retry`,
            });
            continue;
          }

          const { page: completedPage, outcome } = result;
          if (range.updateCheckpoint) {
            highestCompletedPage = Math.max(highestCompletedPage, completedPage);
            // 每 CHECKPOINT_INTERVAL_PAGES 页或到达 range 末尾时才写库，减少 DB 压力
            const isRangeEnd = completedPage === range.end;
            if (isRangeEnd || completedPage % CHECKPOINT_INTERVAL_PAGES === 0) {
              await this.upsertCrawlState(crmKey, strategy.module, mid, {
                lastCompletedPage: highestCompletedPage,
                status: 'running',
              });
            }
          }
          if (
            this.shouldLogProgress(
              completedPage,
              range.end,
              bulkMode ? 0 : outcome.insertedCount,
            )
          ) {
            this.logger.log(
              `明细进度 ${key}: ${range.label} page=${completedPage}/${pagesToFetch} inserted=${outcome.insertedCount}`,
            );
          }
          if (range.stopOnAnchorKeys && outcome.containsAnchor) {
            stoppedByBoundary = true;
            completedInitialDate = range.initialCompletedDate ?? null;
            if (runResult) runResult.anchorFound = true;
            this.logger.log(
              `IVR 命中尾页锚点 ${key}: page=${completedPage}/${pagesToFetch}, 每日初始完成`,
            );
            break;
          }
          if (range.stopOnDuplicatePage && outcome.allRowsDuplicate) {
            stoppedByBoundary = true;
            this.logger.log(
              `IVR 命中整页重复 ${key}: page=${completedPage}/${pagesToFetch}, 增量完成`,
            );
            break;
          }
        }

        if (page <= range.end && !authAborted && !stoppedByBoundary) {
          await sleep(PAGE_DELAY_MS);
        }
      }
      if (authAborted || stoppedByBoundary || pausedByMemory) break;
      // 只有真实跑到本轮发现的尾页，才可认为每日初始锚点完成。
      // 被 VOICE_TABLE_DAILY_MAX_PAGES 截断的 range 不能提前写 initialCompletedDate。
      if (range.initialCompletedDate && range.end >= discoveredTotalPages) {
        completedInitialDate = range.initialCompletedDate;
      }
    }

    if (authAborted) return;
    if (pausedByMemory) return;

    for (const failed of failedPages) {
      try {
        this.logger.log(`补抓 page=${failed.page} ${key}`);
        await this.crawlPage({
          strategy,
          crmKey,
          mid,
          baseUrl,
          headers,
          page: failed.page,
          pagesToFetch,
          taskId,
        });
        highestCompletedPage = Math.max(highestCompletedPage, failed.page);
        await this.upsertCrawlState(crmKey, strategy.module, mid, {
          lastCompletedPage: highestCompletedPage,
        });
      } catch (err: any) {
        const message = err.message || String(err);
        if (this.isAuthError(message)) {
          this.logger.warn(`补抓时 Cookie 失效，中止 ${key}`);
          await this.upsertCrawlState(crmKey, strategy.module, mid, {
            status: 'failed',
          });
          return;
        }
        unresolvedFailedPages++;
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

    if (unresolvedFailedPages > 0) {
      await this.upsertCrawlState(crmKey, strategy.module, mid, {
        totalPages: discoveredTotalPages,
        lastCompletedPage: highestCompletedPage,
        status: 'failed',
      });
      this.logger.warn(
        `明细存在失败页 ${key}: failed=${unresolvedFailedPages}, 保持 failed 等待下轮补抓`,
      );
      return;
    }

    // 补抓完成后标记整体状态。completed 表示本轮计划完成，不表示源系统此刻不再新增。
    await this.upsertCrawlState(crmKey, strategy.module, mid, {
      totalPages: discoveredTotalPages,
      lastCompletedPage: highestCompletedPage,
      status: 'completed',
      ...(completedInitialDate
        ? { initialCompletedDate: completedInitialDate }
        : {}),
    });
    this.ws.broadcastVoiceTableProgress({
      module: strategy.module,
      mid,
      taskId,
      page: highestCompletedPage,
      pagesToFetch,
      status: 'completed',
    });
  }

  private async tryRunRemainingPagesInWorker(args: {
    strategy: VoiceTableStrategy;
    crmKey: string;
    mid: number;
    baseUrl: string;
    headers: Headers;
    pagesToFetch: number;
    discoveredTotalPages: number;
    pageRanges: PageRange[];
    initialLastCompletedPage: number;
    taskId: string;
    key: string;
    runResult?: { anchorFound: boolean };
  }): Promise<boolean> {
    if (process.env.VOICE_TABLE_WORKER_ENABLED === 'false') return false;

    if (!this.resolveWorkerPath()) return false;
    const payload = {
      mode: 'batch',
      crmKey: args.crmKey,
      module: args.strategy.module,
      mid: args.mid,
      baseUrl: args.baseUrl,
      headers: args.headers,
      pagesToFetch: args.pagesToFetch,
      discoveredTotalPages: args.discoveredTotalPages,
      pageRanges: args.pageRanges.map((range) => ({
        ...range,
        stopOnAnchorKeys: range.stopOnAnchorKeys
          ? Array.from(range.stopOnAnchorKeys)
          : undefined,
      })),
      initialLastCompletedPage: args.initialLastCompletedPage,
    };

    this.logger.log(
      `启动表格 worker ${args.key}: ranges=${this.formatPageRanges(
        args.pageRanges,
      )} heap=${this.formatHeapUsage()}`,
    );

    const result = await this.runVoiceTableWorker(payload);

    if (args.runResult && result.anchorFound) {
      args.runResult.anchorFound = true;
    }

    if (!result.success) {
      this.logger.warn(
        `表格 worker 执行失败 ${args.key}: ${result.error ?? 'unknown'}`,
      );
      this.ws.broadcastVoiceTableProgress({
        module: args.strategy.module,
        mid: args.mid,
        taskId: args.taskId,
        page: result.highestCompletedPage || args.initialLastCompletedPage,
        pagesToFetch: args.pagesToFetch,
        status: 'failed',
        error: result.error,
      });
      return true;
    }

    this.logger.log(
      `表格 worker 完成 ${args.key}: page=${result.highestCompletedPage}/${args.pagesToFetch} failed=${result.failedPages}`,
    );
    this.ws.broadcastVoiceTableProgress({
      module: args.strategy.module,
      mid: args.mid,
      taskId: args.taskId,
      page: result.highestCompletedPage,
      pagesToFetch: args.pagesToFetch,
      status: 'completed',
    });
    return true;
  }

  private resolveWorkerPath(): string | null {
    const workerPath =
      process.env.VOICE_TABLE_WORKER_PATH ??
      join(process.cwd(), 'dist', 'workers', 'voice-table-batch.worker.js');
    if (!existsSync(workerPath)) {
      this.logger.warn(
        `表格 worker 文件不存在，回退主进程执行: ${workerPath}`,
      );
      return null;
    }
    return workerPath;
  }

  private async drainHistoryWorkerChain(args: {
    crmKey: string;
    strategy: VoiceTableStrategy;
    mid: number;
    baseUrl: string;
    headers: Headers;
    key: string;
    taskId: string;
  }): Promise<void> {
    const maxBatchesRaw = process.env.VOICE_TABLE_WORKER_CHAIN_MAX;
    const maxBatches =
      maxBatchesRaw == null || maxBatchesRaw.trim() === ''
        ? Number.POSITIVE_INFINITY
        : Math.max(0, parseInt(maxBatchesRaw, 10));
    if (maxBatches === 0) return;

    for (let i = 0; i < maxBatches; i++) {
      this.forceGcIfAvailable(`history-chain-before-${i + 1}`);
      if (this.getHeapUsageRatio() >= MEMORY_PAUSE_HEAP_RATIO) {
        this.logger.warn(
          `历史 worker 连续领取暂停（主进程内存水位过高）${args.key}: heap=${this.formatHeapUsage()}`,
        );
        return;
      }

      const result = await this.runVoiceTableWorker({
        mode: 'history',
        crmKey: args.crmKey,
        module: args.strategy.module,
        mid: args.mid,
        baseUrl: args.baseUrl,
        headers: args.headers,
        pagesToFetch: HISTORY_BATCH_SIZE,
      });

      if (!result.success) {
        this.logger.warn(
          `历史 worker batch 失败 ${args.key}: ${result.error ?? 'unknown'}`,
        );
        this.ws.broadcastVoiceTableProgress({
          module: args.strategy.module,
          mid: args.mid,
          taskId: args.taskId,
          page: result.highestCompletedPage || 0,
          pagesToFetch: result.pagesToFetch ?? 0,
          status: 'failed',
          error: result.error,
        });
        return;
      }

      this.forceGcIfAvailable(`history-chain-after-${i + 1}`);
      if (!result.hasMoreHistory) {
        this.logger.log(`历史 worker 补全已无待领取 batch ${args.key}`);
        return;
      }

      this.logger.log(
        `历史 worker batch 完成 ${args.key}: ${i + 1}/${Number.isFinite(maxBatches) ? maxBatches : '∞'} page=${result.highestCompletedPage}/${result.totalPages}`,
      );
      this.ws.broadcastVoiceTableProgress({
        module: args.strategy.module,
        mid: args.mid,
        taskId: args.taskId,
        page: result.highestCompletedPage,
        pagesToFetch: result.totalPages ?? result.pagesToFetch ?? 0,
        status: 'running',
      });
    }
  }

  private async runVoiceTableWorker(payload: Record<string, any>): Promise<{
    success: boolean;
    highestCompletedPage: number;
    anchorFound: boolean;
    completedInitialDate: string | null;
    failedPages: number;
    module?: VoiceModule;
    mid?: number;
    totalPages?: number;
    pagesToFetch?: number;
    hasMoreHistory?: boolean;
    error?: string;
  }> {
    const workerPath = this.resolveWorkerPath();
    if (!workerPath) {
      throw new Error('voice-table worker not found');
    }

    return new Promise((resolve, reject) => {
      const timeoutMs = this.getWorkerTimeoutMs();
      const child = fork(workerPath, [], {
        env: {
          ...process.env,
          VOICE_TABLE_WORKER_PAYLOAD: JSON.stringify(payload),
        },
        execArgv: ['--max-old-space-size=512'],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });

      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGKILL');
        reject(
          new Error(
            `voice-table worker timeout after ${timeoutMs}ms mode=${payload.mode ?? 'batch'} module=${payload.module ?? 'unknown'} mid=${payload.mid ?? 'unknown'}`,
          ),
        );
      }, timeoutMs);
      timeout.unref();

      const cleanup = () => clearTimeout(timeout);
      child.stdout?.on('data', (chunk) => {
        this.logger.log(`[voice-table-worker] ${String(chunk).trim()}`);
      });
      child.stderr?.on('data', (chunk) => {
        this.logger.warn(`[voice-table-worker] ${String(chunk).trim()}`);
      });
      child.on('message', (message) => {
        settled = true;
        cleanup();
        resolve(message as any);
      });
      child.on('error', (err) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(err);
        }
      });
      child.on('exit', (code, signal) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(
            new Error(
              `voice-table worker exited code=${code ?? 'null'} signal=${
                signal ?? 'null'
              }`,
            ),
          );
        }
      });
    });
  }

  private getWorkerTimeoutMs(): number {
    const raw = process.env.VOICE_TABLE_WORKER_TIMEOUT_MS;
    if (!raw) return DEFAULT_WORKER_TIMEOUT_MS;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULT_WORKER_TIMEOUT_MS;
  }

  private async crawlPage(args: {
    strategy: VoiceTableStrategy;
    crmKey: string;
    mid: number;
    baseUrl: string;
    headers: Headers;
    page: number;
    pagesToFetch: number;
    taskId: string;
    anchorKeys?: Set<string>;
    /** 历史补全模式：跳过全量 rows WS 广播，每 50 页发一次 progress */
    isHistoryMode?: boolean;
  }): Promise<CrawlPageOutcome> {
    const {
      strategy,
      crmKey,
      mid,
      baseUrl,
      headers,
      page,
      pagesToFetch,
      taskId,
      anchorKeys,
      isHistoryMode,
    } = args;
    const pageUrl = ensurePageIdParam(baseUrl, page);
    const html = await this.fetchHtmlWithRetry(pageUrl, headers);
    const parsed = strategy.parse(html);
    const inserted = await this.persistRows(
      strategy.module,
      crmKey,
      mid,
      baseUrl,
      parsed.rows,
    );

    // 历史补全模式跳过全量行广播（历史数据不属于实时面板关注范围）
    if (!isHistoryMode && inserted.length > 0) {
      this.ws.broadcastVoiceTableRows({
        module: strategy.module,
        mid,
        page,
        rows: inserted,
        taskId,
        timestamp: new Date().toISOString(),
      });
    }

    // 历史补全每 50 页或批次结束时才推进度，减少 WS 对象分配
    const shouldBroadcastProgress =
      !isHistoryMode ||
      page % 50 === 0 ||
      page === pagesToFetch;
    if (shouldBroadcastProgress) {
      this.ws.broadcastVoiceTableProgress({
        module: strategy.module,
        mid,
        taskId,
        page,
        pagesToFetch,
        status: page === pagesToFetch ? 'completed' : 'running',
      });
    }
    return {
      insertedCount: inserted.length,
      containsAnchor:
        anchorKeys != null &&
        this.rowsContainIvrAnchor(crmKey, mid, parsed.rows, anchorKeys),
      allRowsDuplicate: parsed.rows.length > 0 && inserted.length === 0,
    };
  }

  private async fetchIvrTailAnchorKeys(args: {
    strategy: VoiceTableStrategy;
    crmKey: string;
    mid: number;
    baseUrl: string;
    headers: Headers;
    totalPages: number;
  }): Promise<Set<string>> {
    const { strategy, crmKey, mid, baseUrl, headers, totalPages } = args;
    const keys = new Set<string>();
    if (totalPages <= 1) return keys;

    const start = Math.max(2, totalPages - IVR_TAIL_ANCHOR_PAGES + 1);
    for (let page = start; page <= totalPages; page++) {
      const pageUrl = ensurePageIdParam(baseUrl, page);
      const html = await this.fetchHtmlWithRetry(pageUrl, headers);
      const parsed = strategy.parse(html);
      for (const row of parsed.rows as ParsedRowVoiceIvr[]) {
        const key = this.buildIvrAnchorKey(crmKey, mid, row);
        if (key) keys.add(key);
      }
      this.logger.log(
        `IVR 尾页锚点 ${strategy.module}:${mid}: page=${page}/${totalPages} anchors=${keys.size}`,
      );
    }
    return keys;
  }

  private rowsContainIvrAnchor(
    crmKey: string,
    mid: number,
    rows: ParsedRowVoiceIvr[] | ParsedRowVoiceOp[],
    anchorKeys: Set<string>,
  ): boolean {
    for (const row of rows as ParsedRowVoiceIvr[]) {
      const key = this.buildIvrAnchorKey(crmKey, mid, row);
      if (key && anchorKeys.has(key)) return true;
    }
    return false;
  }

  private getBusinessDate(
    module: VoiceModule,
    rows: ParsedRowVoiceIvr[] | ParsedRowVoiceOp[],
  ): string | null {
    return module === 'voice_ivr'
      ? this.getIvrBusinessDate(rows as ParsedRowVoiceIvr[])
      : this.getOpBusinessDate(rows as ParsedRowVoiceOp[]);
  }

  private getIvrBusinessDate(rows: ParsedRowVoiceIvr[]): string | null {
    for (const row of rows) {
      if (row.callDate) return this.formatDateKey(row.callDate);
    }
    return null;
  }

  private getOpBusinessDate(rows: ParsedRowVoiceOp[]): string | null {
    for (const row of rows) {
      if (row.callDate) return this.formatDateKey(row.callDate);
    }
    return null;
  }

  private buildIvrAnchorKey(
    crmKey: string,
    mid: number,
    row: ParsedRowVoiceIvr,
  ): string | null {
    if (!row.recordId || !row.callDate) return null;
    return `${crmKey}|${mid}|${this.formatDateKey(row.callDate)}|${row.recordId}`;
  }

  private formatDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private buildResumeRanges(args: {
    lastCompletedPage: number;
    previousTotalPages: number;
    pagesToFetch: number;
  }): PageRange[] {
    const { lastCompletedPage, previousTotalPages, pagesToFetch } = args;
    const deltaPages = Math.max(0, pagesToFetch - previousTotalPages);
    const ranges: PageRange[] = [];

    if (deltaPages > 0) {
      const frontEnd = Math.min(
        pagesToFetch,
        deltaPages + RESUME_OVERLAP_PAGES,
      );
      if (frontEnd >= 2) {
        ranges.push({
          start: 2,
          end: frontEnd,
          label: '补扫最新区',
          updateCheckpoint: false,
        });
      }
    }

    const resumeStart = Math.max(
      2,
      lastCompletedPage - RESUME_OVERLAP_PAGES + 1,
    );
    if (resumeStart <= pagesToFetch) {
      ranges.push({
        start: resumeStart,
        end: pagesToFetch,
        label: '断点续抓',
        updateCheckpoint: true,
      });
    }

    return this.mergePageRanges(ranges);
  }

  private mergePageRanges(ranges: PageRange[]): PageRange[] {
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const merged: PageRange[] = [];

    for (const range of sorted) {
      const last = merged[merged.length - 1];
      if (!last || range.start > last.end + 1) {
        merged.push({ ...range });
        continue;
      }

      last.end = Math.max(last.end, range.end);
      last.updateCheckpoint = last.updateCheckpoint || range.updateCheckpoint;
      last.label =
        last.label === range.label
          ? last.label
          : `${last.label}+${range.label}`;
    }

    return merged;
  }

  private formatPageRanges(ranges: PageRange[]): string {
    if (ranges.length === 0) return '无后续页';
    return ranges
      .map((r) => {
        const displayStart =
          r.start === 2 && r.label.includes('补扫最新区') ? 1 : r.start;
        return `${r.label} ${displayStart}-${r.end}`;
      })
      .join(', ');
  }

  private shouldLogProgress(
    page: number,
    rangeEnd: number,
    insertedCount: number,
  ): boolean {
    return (
      insertedCount > 0 ||
      page === rangeEnd ||
      page % PROGRESS_LOG_INTERVAL_PAGES === 0
    );
  }

  private isBulkPageRange(module: VoiceModule, range: PageRange): boolean {
    if (module !== 'voice_ivr') return false;
    return (
      range.initialCompletedDate != null ||
      range.end - range.start + 1 >= CHECKPOINT_INTERVAL_PAGES
    );
  }

  private getHeapUsageRatio(): number {
    const { heapUsed } = process.memoryUsage();
    const { heap_size_limit: heapLimit } = getHeapStatistics();
    return heapLimit > 0 ? heapUsed / heapLimit : 0;
  }

  private formatHeapUsage(): string {
    const { heapUsed, heapTotal, rss } = process.memoryUsage();
    const { heap_size_limit: heapLimit } = getHeapStatistics();
    const mb = 1024 * 1024;
    return `heap=${(heapUsed / mb).toFixed(1)}/${(heapTotal / mb).toFixed(
      1,
    )}MB limit=${(heapLimit / mb).toFixed(1)}MB rss=${(rss / mb).toFixed(1)}MB`;
  }

  private forceGcIfAvailable(reason: string): void {
    const maybeGc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
    if (typeof maybeGc !== 'function') return;

    const before = this.formatHeapUsage();
    try {
      maybeGc();
      this.logger.debug(
        `主动 GC 完成 ${reason}: before=${before} after=${this.formatHeapUsage()}`,
      );
    } catch (err: any) {
      this.logger.warn(`主动 GC 失败 ${reason}: ${err.message}`);
    }
  }

  private async getLastTotalPages(
    crmKey: string,
    module: VoiceModule,
    mid: number,
  ): Promise<number | null> {
    const repo =
      module === 'voice_ivr' ? this.ivrSummaryRepo : this.opSummaryRepo;
    const last = await repo
      .createQueryBuilder('s')
      .where('s."crmKey" = :crmKey', { crmKey })
      .andWhere('s.mid = :mid', { mid })
      .andWhere('(s."totalRecords" > 0 OR s."totalPages" > 1)')
      .orderBy('s."capturedAt"', 'DESC')
      .getOne();
    return last ? last.totalPages : null;
  }

  private async persistRows(
    module: VoiceModule,
    crmKey: string,
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
        e.crmKey = crmKey;
        e.mid = mid;
        e.recordId = r.recordId;
        e.src = r.src;
        e.dst = r.dst;
        e.statusType = r.statusType;
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
        .returning([
          'id',
          'crmKey',
          'mid',
          'recordId',
          'src',
          'dst',
          'statusType',
          'callDate',
        ])
        .execute();
      return (result.raw as any[]) ?? [];
    }

    const opRows = rows as ParsedRowVoiceOp[];
    const entities = opRows.map((r) => {
      const e = new VoiceOpRecord();
      e.id = uuidv4();
      e.crmKey = crmKey;
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

    return this.upsertVoiceOpRecords(entities);
  }

  private async upsertVoiceOpRecords(entities: VoiceOpRecord[]): Promise<any[]> {
    const result = await this.opRecordRepo
      .createQueryBuilder()
      .insert()
      .into(VoiceOpRecord)
      .values(entities)
      .onConflict(
        `("crmKey", mid, src, dst, ("callDate"::date)) WHERE "callDate" IS NOT NULL DO UPDATE SET
          "recordKey" = EXCLUDED."recordKey",
          task = EXCLUDED.task,
          agent = EXCLUDED.agent,
          reason = EXCLUDED.reason,
          duration = EXCLUDED.duration,
          "callDate" = EXCLUDED."callDate",
          "endDate" = EXCLUDED."endDate",
          "sourceUrl" = EXCLUDED."sourceUrl"
        WHERE
          voice_op_records."recordKey" IS DISTINCT FROM EXCLUDED."recordKey"
          OR voice_op_records.task IS DISTINCT FROM EXCLUDED.task
          OR voice_op_records.agent IS DISTINCT FROM EXCLUDED.agent
          OR voice_op_records.reason IS DISTINCT FROM EXCLUDED.reason
          OR voice_op_records.duration IS DISTINCT FROM EXCLUDED.duration
          OR voice_op_records."callDate" IS DISTINCT FROM EXCLUDED."callDate"
          OR voice_op_records."endDate" IS DISTINCT FROM EXCLUDED."endDate"
          OR voice_op_records."sourceUrl" IS DISTINCT FROM EXCLUDED."sourceUrl"`,
      )
      .returning([
        'id',
        'crmKey',
        'mid',
        'recordKey',
        'src',
        'dst',
        'callDate',
      ])
      .execute();
    return (result.raw as any[]) ?? [];
  }

  private async persistSummary(
    strategy: VoiceTableStrategy,
    crmKey: string,
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
        where: { crmKey, mid },
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
      e.crmKey = crmKey;
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
        where: { crmKey, mid },
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
      e.crmKey = crmKey;
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
          let receivedBytes = 0;
          let abortedBySize = false;

          res.on('data', (c: Buffer) => {
            receivedBytes += c.length;
            if (receivedBytes > MAX_VOICE_TABLE_HTML_BYTES) {
              abortedBySize = true;
              req.destroy(
                new Error(
                  `response too large: ${receivedBytes} bytes > ${MAX_VOICE_TABLE_HTML_BYTES} bytes`,
                ),
              );
              return;
            }
            chunks.push(c);
          });
          res.on('end', () => {
            if (abortedBySize) return;
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

  /** 判断是否为认证失败错误（401/403），这类错误不应重试 */
  private isAuthError(message: string): boolean {
    return /HTTP (401|403)/.test(message);
  }

  private normalizeCrmKey(value: string): string {
    try {
      const parsed = new URL(value);
      return parsed.host.toLowerCase();
    } catch {
      return value.trim().toLowerCase() || 'unknown';
    }
  }

  /** 插入或更新 VoiceCrawlState（以 crmKey+module+mid 为 key）。
   *  先直接 UPDATE，只有行不存在时才 INSERT，避免每次都 findOne。
   */
  private async upsertCrawlState(
    crmKey: string,
    module: string,
    mid: number,
    update: Partial<
      Pick<
        VoiceCrawlState,
        | 'totalPages'
        | 'lastCompletedPage'
        | 'status'
        | 'initialCompletedDate'
        | 'historyStatus'
        | 'historyNextPage'
        | 'historyTotalPagesRef'
        | 'historyLastRecordId'
        | 'historyBatchStartedAt'
        | 'historyBatchFinishedAt'
      >
    >,
  ): Promise<void> {
    const result = await this.crawlStateRepo
      .createQueryBuilder()
      .update(VoiceCrawlState)
      .set(update)
      .where('"crmKey" = :crmKey AND module = :module AND mid = :mid', {
        crmKey,
        module,
        mid,
      })
      .execute();

    if (result.affected === 0) {
      const s = new VoiceCrawlState();
      s.id = uuidv4();
      s.crmKey = crmKey;
      s.module = module;
      s.mid = mid;
      s.totalPages = update.totalPages ?? 1;
      s.lastCompletedPage = update.lastCompletedPage ?? 0;
      s.status = (update.status ?? 'running') as CrawlStateStatus;
      s.initialCompletedDate = update.initialCompletedDate ?? null;
      s.historyStatus = update.historyStatus ?? null;
      s.historyNextPage = update.historyNextPage ?? null;
      s.historyTotalPagesRef = update.historyTotalPagesRef ?? null;
      s.historyLastRecordId = update.historyLastRecordId ?? null;
      s.historyBatchStartedAt = update.historyBatchStartedAt ?? null;
      s.historyBatchFinishedAt = update.historyBatchFinishedAt ?? null;
      await this.crawlStateRepo.save(s);
    }
  }

  // ── 历史补全 ──────────────────────────────────────────────────────────────

  /**
   * 在日常扫描触碰上限后，将历史补全游标写入 DB，然后（内存允许时）立即启动一批。
   */
  private async scheduleAndRunHistoryBatch(args: {
    strategy: VoiceTableStrategy;
    crmKey: string;
    mid: number;
    baseUrl: string;
    headers: Headers;
    key: string;
    totalPagesRef: number;
    nextPage: number;
    businessDate?: string;
    resetHistoryCursor?: boolean;
  }): Promise<void> {
    const {
      strategy,
      crmKey,
      mid,
      key,
      totalPagesRef,
      nextPage,
      resetHistoryCursor,
    } = args;

    // 写入或更新历史游标（仅当尚无待运行游标时才覆盖 nextPage）
    const existing = await this.crawlStateRepo.findOne({
      where: { crmKey, module: strategy.module, mid },
    });
    const alreadyPending =
      !resetHistoryCursor &&
      (existing?.historyStatus === 'pending' ||
        existing?.historyStatus === 'running');

    await this.upsertCrawlState(crmKey, strategy.module, mid, {
      historyStatus: 'pending',
      // 只有首次设置或已完成后重置时才更新 nextPage 和 totalPagesRef
      ...(alreadyPending
        ? {}
        : {
            historyNextPage: nextPage,
            historyTotalPagesRef: totalPagesRef,
          }),
    });

    // 内存水位检查：超过 70% 时跳过本次批次，等下一个 5 分钟再试
    const { heapUsed, heapTotal } = process.memoryUsage();
    const memRatio = heapUsed / heapTotal;
    if (memRatio > 0.70) {
      this.logger.warn(
        `历史补全跳过（内存水位 ${(memRatio * 100).toFixed(1)}% > 70%）${key}`,
      );
      return;
    }

    if (this.historyActiveMap.get(key)) return;
    this.historyActiveMap.set(key, true);
    try {
      await this.runHistoryBatch(args);
    } finally {
      this.historyActiveMap.delete(key);
    }
  }

  /**
   * 执行一批历史补全（HISTORY_BATCH_SIZE 页）。
   * - 通过 totalPagesRef diff 估算页码漂移，自动调整起始页。
   * - 超过内存危险水位（85%）时中断批次并保存进度。
   * - IVR 每批重新获取尾页锚点，命中后标记 initialCompletedDate。
   */
  private async runHistoryBatch(args: {
    strategy: VoiceTableStrategy;
    crmKey: string;
    mid: number;
    baseUrl: string;
    headers: Headers;
    key: string;
    businessDate?: string;
  }): Promise<void> {
    const { strategy, crmKey, mid, baseUrl, headers, key, businessDate } =
      args;

    const state = await this.crawlStateRepo.findOne({
      where: { crmKey, module: strategy.module, mid },
    });
    if (!state || state.historyStatus !== 'pending') return;

    // 获取当前总页数（同时验证 Cookie 是否仍有效）
    let currentTotalPages: number;
    try {
      const firstHtml = await this.fetchHtml(
        ensurePageIdParam(baseUrl, 1),
        headers,
      );
      const firstParsed = strategy.parse(firstHtml);
      currentTotalPages = firstParsed.totalPages || 1;
    } catch (err: any) {
      this.logger.warn(`历史补全获取首页失败 ${key}: ${err.message}`);
      return;
    }

    // 计算页码漂移并修正起始页
    const drift = state.historyTotalPagesRef
      ? Math.max(0, currentTotalPages - state.historyTotalPagesRef)
      : 0;
    const adjustedStart = Math.min(
      currentTotalPages,
      (state.historyNextPage ?? VOICE_TABLE_DAILY_MAX_PAGES + 1) + drift,
    );

    if (adjustedStart > currentTotalPages) {
      // 所有历史页已处理完毕
      await this.upsertCrawlState(crmKey, strategy.module, mid, {
        historyStatus: 'completed',
        historyBatchFinishedAt: new Date(),
      });
      this.logger.log(`历史补全已完成 ${key}: totalPages=${currentTotalPages}`);
      return;
    }

    const batchEnd = Math.min(
      currentTotalPages,
      adjustedStart + HISTORY_BATCH_SIZE - 1,
    );

    // 标记批次开始
    await this.upsertCrawlState(crmKey, strategy.module, mid, {
      historyStatus: 'running',
      historyNextPage: adjustedStart,
      historyTotalPagesRef: currentTotalPages,
      historyBatchStartedAt: new Date(),
    });
    this.logger.log(
      `历史补全批次开始 ${key}: page=${adjustedStart}-${batchEnd}/${currentTotalPages} drift=${drift}`,
    );

    // IVR 重新获取尾页锚点（每批获取，2 次额外 fetch，代价小）
    let tailAnchorKeys: Set<string> | undefined;
    if (strategy.module === 'voice_ivr' && businessDate) {
      try {
        tailAnchorKeys = await this.fetchIvrTailAnchorKeys({
          strategy,
          crmKey,
          mid,
          baseUrl,
          headers,
          totalPages: currentTotalPages,
        });
      } catch {
        // 失败时不阻断批次，只是无法命中锚点
      }
    }

    const taskId = uuidv4();
    let anchorFoundInBatch = false;
    let checkpointPage = adjustedStart - 1;

    for (let page = adjustedStart; page <= batchEnd; page++) {
      // 内存危险水位检查
      const { heapUsed, heapTotal } = process.memoryUsage();
      if (heapUsed / heapTotal > MEMORY_DANGER_HEAP_RATIO) {
        this.logger.warn(
          `历史补全内存告警，暂停批次于 page=${page} ${key}`,
        );
        break;
      }

      try {
        const outcome = await this.crawlPage({
          strategy,
          crmKey,
          mid,
          baseUrl,
          headers,
          page,
          pagesToFetch: batchEnd,
          taskId,
          anchorKeys: tailAnchorKeys,
          isHistoryMode: true,
        });

        checkpointPage = page;

        if (tailAnchorKeys && outcome.containsAnchor) {
          anchorFoundInBatch = true;
          this.logger.log(
            `历史补全命中 IVR 尾页锚点 ${key}: page=${page}, 初始化完成`,
          );
          break;
        }

        // 历史补全每 CHECKPOINT_INTERVAL_PAGES 页记录一次进度
        if (page % CHECKPOINT_INTERVAL_PAGES === 0 || page === batchEnd) {
          await this.upsertCrawlState(crmKey, strategy.module, mid, {
            historyNextPage: page + 1,
            historyTotalPagesRef: currentTotalPages,
          });
        }
      } catch (err: any) {
        this.logger.warn(`历史补全 page=${page} 失败 ${key}: ${err.message}`);
        // 历史补全宁可下轮重扫当前页，也不要跳过失败页造成漏数。
        break;
      }

      if (page < batchEnd) await sleep(PAGE_DELAY_MS);
    }

    // 批次结束：更新游标
    const isDone = anchorFoundInBatch || checkpointPage >= currentTotalPages;
    const nextHistoryPage = isDone
      ? null
      : Math.max(adjustedStart, checkpointPage + 1);

    await this.upsertCrawlState(crmKey, strategy.module, mid, {
      historyStatus: isDone ? 'completed' : 'pending',
      historyNextPage: nextHistoryPage,
      historyTotalPagesRef: isDone ? null : currentTotalPages,
      historyBatchFinishedAt: new Date(),
      ...(isDone && businessDate
        ? { initialCompletedDate: businessDate }
        : {}),
    });

    this.logger.log(
      `历史补全批次完成 ${key}: page=${adjustedStart}-${checkpointPage}` +
        ` anchorFound=${anchorFoundInBatch} done=${isDone}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
