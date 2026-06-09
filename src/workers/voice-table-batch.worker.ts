import 'reflect-metadata';
import * as http from 'http';
import * as https from 'https';
import { DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { VoiceCrawlState } from '../modules/voice-table/entities/voice-crawl-state.entity';
import { VoiceIvrRecord } from '../modules/voice-table/entities/voice-ivr-record.entity';
import { VoiceIvrSummary } from '../modules/voice-table/entities/voice-ivr-summary.entity';
import { VoiceOpRecord } from '../modules/voice-table/entities/voice-op-record.entity';
import { VoiceOpSummary } from '../modules/voice-table/entities/voice-op-summary.entity';
import { ensurePageIdParam, resolveStrategy } from '../modules/voice-table/strategies/registry';
import {
  ParsedRowVoiceIvr,
  ParsedRowVoiceOp,
  VoiceModule,
  VoiceTableStrategy,
} from '../modules/voice-table/strategies/strategy.types';

/** 单页 HTTP 请求超时（毫秒） */
const REQUEST_TIMEOUT_MS = 30_000;
/** 单页抓取失败后的最大重试次数（实际最多尝试 MAX_RETRIES + 1 次） */
const MAX_RETRIES = 2;
/** 翻页间隔，避免对 CRM 请求过于密集 */
const PAGE_DELAY_MS = 50;
/** 表格翻页请求最大并发数 */
const TABLE_PAGE_CONCURRENCY = 3;
/** checkpoint 写库间隔页数，降低高频 DB 往返开销 */
const CHECKPOINT_INTERVAL_PAGES = 50;
/** 单页 HTML 响应体大小上限（2MB），超出则拒绝 */
const MAX_VOICE_TABLE_HTML_BYTES = 2 * 1024 * 1024;
/** 增量抓取时每次至少处理的页数（总页数不变时也会扫这么多页做查重） */
const MIN_DETAIL_PAGES_PER_RUN = 10;
/** 断点续抓时往回重叠的页数，防止页码漂移或末页半完成导致漏数据 */
const RESUME_OVERLAP_PAGES = 2;
/** 单次日常明细扫描最多处理页数；超出部分交由历史补全任务分批续跑 */
const VOICE_TABLE_DAILY_MAX_PAGES = 10;
/** 历史补全每批抓取页数 */
const HISTORY_BATCH_SIZE = 50;

type Headers = Record<string, string>;

interface WorkerPageRange {
  start: number;
  end: number;
  label: string;
  updateCheckpoint: boolean;
  stopOnDuplicatePage?: boolean;
  stopOnAnchorKeys?: string[];
  initialCompletedDate?: string;
}

interface WorkerPayload {
  mode?: 'start' | 'batch' | 'history';
  crmKey: string;
  module?: VoiceModule;
  mid: number;
  baseUrl: string;
  headers: Headers;
  pagesToFetch?: number;
  discoveredTotalPages?: number;
  pageRanges?: WorkerPageRange[];
  initialLastCompletedPage?: number;
}

interface WorkerResult {
  success: boolean;
  highestCompletedPage: number;
  anchorFound: boolean;
  stoppedByBoundary: boolean;
  completedInitialDate: string | null;
  failedPages: number;
  module?: VoiceModule;
  mid?: number;
  totalPages?: number;
  pagesToFetch?: number;
  hasMoreHistory?: boolean;
  error?: string;
}

async function main() {
  const payloadRaw = process.env.VOICE_TABLE_WORKER_PAYLOAD;
  if (!payloadRaw) throw new Error('VOICE_TABLE_WORKER_PAYLOAD missing');

  const payload = JSON.parse(payloadRaw) as WorkerPayload;
  const strategy = resolveStrategy(payload.baseUrl);
  if (!strategy || (payload.module && strategy.module !== payload.module)) {
    throw new Error(`unsupported worker url/module: ${payload.baseUrl}`);
  }

  const dataSource = await createDataSource().initialize();
  try {
    logWorker(
      `start mode=${payload.mode ?? 'batch'} module=${strategy.module} mid=${payload.mid} baseUrl=${payload.baseUrl}`,
    );
    const result =
      payload.mode === 'start'
        ? await runStartCrawl(dataSource, strategy, payload)
        : payload.mode === 'history'
          ? await runHistoryBatch(dataSource, strategy, payload)
        : await runBatch(dataSource, strategy, payload as Required<WorkerPayload>);
    logWorker(
      `done mode=${payload.mode ?? 'batch'} success=${result.success} page=${result.highestCompletedPage}/${result.totalPages ?? result.pagesToFetch ?? '-'} hasMoreHistory=${Boolean(result.hasMoreHistory)}`,
    );
    sendResult(result);
  } finally {
    await dataSource.destroy();
  }
}

async function runHistoryBatch(
  dataSource: DataSource,
  strategy: VoiceTableStrategy,
  payload: WorkerPayload,
): Promise<WorkerResult> {
  const state = await dataSource.getRepository(VoiceCrawlState).findOne({
    where: { crmKey: payload.crmKey, module: strategy.module, mid: payload.mid },
  });
  if (!state || !['pending', 'running'].includes(state.historyStatus ?? '')) {
    return {
      success: true,
      highestCompletedPage: 0,
      anchorFound: false,
      stoppedByBoundary: false,
      completedInitialDate: null,
      failedPages: 0,
      module: strategy.module,
      mid: payload.mid,
      pagesToFetch: 0,
      hasMoreHistory: false,
    };
  }

  const firstHtml = await fetchHtmlWithRetry(ensurePageIdParam(payload.baseUrl, 1), payload.headers);
  const firstParsed = strategy.parse(firstHtml);
  const currentTotalPages = firstParsed.totalPages || 1;
  logWorker(
    `history first-page module=${strategy.module} mid=${payload.mid} html=${firstHtml.length} totalPages=${currentTotalPages}`,
  );
  const ivrBusinessDate =
    strategy.module === 'voice_ivr'
      ? getIvrBusinessDate(firstParsed.rows as ParsedRowVoiceIvr[])
      : null;
  const drift = state.historyTotalPagesRef
    ? Math.max(0, currentTotalPages - state.historyTotalPagesRef)
    : 0;
  const adjustedStart = Math.min(
    currentTotalPages,
    (state.historyNextPage ?? VOICE_TABLE_DAILY_MAX_PAGES + 1) + drift,
  );

  if (adjustedStart > currentTotalPages) {
    await upsertCrawlState(dataSource, payload.crmKey, strategy.module, payload.mid, {
      historyStatus: 'completed',
      historyBatchFinishedAt: new Date(),
    });
    return {
      success: true,
      highestCompletedPage: currentTotalPages,
      anchorFound: false,
      stoppedByBoundary: false,
      completedInitialDate: null,
      failedPages: 0,
      module: strategy.module,
      mid: payload.mid,
      totalPages: currentTotalPages,
      pagesToFetch: 0,
      hasMoreHistory: false,
    };
  }

  const batchEnd = Math.min(
    currentTotalPages,
    adjustedStart + (payload.pagesToFetch ?? HISTORY_BATCH_SIZE) - 1,
  );
  const tailAnchorKeys =
    strategy.module === 'voice_ivr'
      ? await fetchIvrTailAnchorKeys(dataSource, strategy, payload, currentTotalPages)
      : new Set<string>();
  logWorker(
    `history batch range module=${strategy.module} mid=${payload.mid} page=${adjustedStart}-${batchEnd}/${currentTotalPages} anchors=${tailAnchorKeys.size}`,
  );

  await upsertCrawlState(dataSource, payload.crmKey, strategy.module, payload.mid, {
    historyStatus: 'running',
    historyNextPage: adjustedStart,
    historyTotalPagesRef: currentTotalPages,
    historyBatchStartedAt: new Date(),
  });

  const batchResult = await runBatch(dataSource, strategy, {
    ...payload,
    module: strategy.module,
    pagesToFetch: batchEnd,
    discoveredTotalPages: currentTotalPages,
    pageRanges: [
      {
        start: adjustedStart,
        end: batchEnd,
        label: '历史补全',
        updateCheckpoint: false,
        stopOnAnchorKeys: Array.from(tailAnchorKeys),
        initialCompletedDate:
          strategy.module === 'voice_ivr'
            ? (ivrBusinessDate ?? undefined)
            : undefined,
      },
    ],
    initialLastCompletedPage: adjustedStart - 1,
  } as Required<WorkerPayload>);

  if (!batchResult.success) {
    await upsertCrawlState(dataSource, payload.crmKey, strategy.module, payload.mid, {
      historyStatus: 'pending',
      historyNextPage: adjustedStart,
      historyTotalPagesRef: currentTotalPages,
      historyBatchFinishedAt: new Date(),
    });
    return {
      ...batchResult,
      module: strategy.module,
      mid: payload.mid,
      totalPages: currentTotalPages,
      pagesToFetch: batchEnd,
      hasMoreHistory: true,
    };
  }

  const isDone = batchResult.anchorFound || batchResult.highestCompletedPage >= currentTotalPages;
  await upsertCrawlState(dataSource, payload.crmKey, strategy.module, payload.mid, {
    historyStatus: isDone ? 'completed' : 'pending',
    historyNextPage: isDone ? null : batchResult.highestCompletedPage + 1,
    historyTotalPagesRef: isDone ? null : currentTotalPages,
    historyBatchFinishedAt: new Date(),
    ...(strategy.module === 'voice_ivr' && batchResult.anchorFound && ivrBusinessDate
      ? { initialCompletedDate: ivrBusinessDate }
      : {}),
  });

  return {
    ...batchResult,
    module: strategy.module,
    mid: payload.mid,
    totalPages: currentTotalPages,
    pagesToFetch: batchEnd,
    hasMoreHistory: !isDone,
  };
}

async function runStartCrawl(
  dataSource: DataSource,
  strategy: VoiceTableStrategy,
  payload: WorkerPayload,
): Promise<WorkerResult> {
  const firstHtml = await fetchHtmlWithRetry(ensurePageIdParam(payload.baseUrl, 1), payload.headers);
  const firstParsed = strategy.parse(firstHtml);
  const totalPages = firstParsed.totalPages || 1;
  logWorker(
    `start first-page module=${strategy.module} mid=${payload.mid} html=${firstHtml.length} rows=${firstParsed.rows.length} totalPages=${totalPages}`,
  );
  const crawlState = await dataSource.getRepository(VoiceCrawlState).findOne({
    where: { crmKey: payload.crmKey, module: strategy.module, mid: payload.mid },
  });
  const hasPendingHistory =
    crawlState?.historyStatus === 'pending' || crawlState?.historyStatus === 'running';
  const isIncomplete =
    crawlState && crawlState.status !== 'completed' && crawlState.lastCompletedPage > 0;
  const ivrBusinessDate =
    strategy.module === 'voice_ivr'
      ? getIvrBusinessDate(firstParsed.rows as ParsedRowVoiceIvr[])
      : null;
  const needsIvrDailyAnchor =
    strategy.module === 'voice_ivr' &&
    ivrBusinessDate != null &&
    crawlState?.initialCompletedDate !== ivrBusinessDate;

  let pagesToFetch: number;
  let pageRanges: WorkerPageRange[];
  let shouldBackfillHistory = false;
  if (needsIvrDailyAnchor) {
    shouldBackfillHistory = true;
    const tailAnchorKeys = await fetchIvrTailAnchorKeys(dataSource, strategy, payload, totalPages);
    const dailyCap = Math.min(totalPages, VOICE_TABLE_DAILY_MAX_PAGES);
    pagesToFetch = dailyCap;
    pageRanges =
      dailyCap >= 2
        ? [
            {
              start: 2,
              end: dailyCap,
              label: '每日初始锚点',
              updateCheckpoint: true,
              stopOnAnchorKeys: Array.from(tailAnchorKeys),
              initialCompletedDate: ivrBusinessDate,
            },
          ]
        : [];
    logWorker(
      `start daily-anchor module=${strategy.module} mid=${payload.mid} date=${ivrBusinessDate} range=2-${dailyCap}/${totalPages} anchors=${tailAnchorKeys.size}`,
    );
  } else if (strategy.module === 'voice_ivr') {
    pagesToFetch = Math.min(totalPages, VOICE_TABLE_DAILY_MAX_PAGES);
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
  } else if (isIncomplete) {
    pagesToFetch = Math.max(crawlState.totalPages, totalPages);
    pageRanges = buildResumeRanges({
      lastCompletedPage: crawlState.lastCompletedPage,
      previousTotalPages: crawlState.totalPages,
      pagesToFetch,
    });
  } else {
    const lastTotalPages = await getLastTotalPages(dataSource, payload.crmKey, strategy.module, payload.mid);
    if (lastTotalPages == null || totalPages < lastTotalPages) {
      pagesToFetch = totalPages;
      shouldBackfillHistory = true;
    } else {
      pagesToFetch = Math.max(MIN_DETAIL_PAGES_PER_RUN, totalPages - lastTotalPages + 1);
    }
    pagesToFetch = Math.min(pagesToFetch, totalPages, VOICE_TABLE_DAILY_MAX_PAGES);
    pageRanges =
      pagesToFetch >= 2
        ? [{ start: 2, end: pagesToFetch, label: '增量', updateCheckpoint: true }]
        : [];
  }

  const insertedFirst = await persistRows(
    dataSource,
    strategy.module,
    payload.crmKey,
    payload.mid,
    payload.baseUrl,
    firstParsed.rows,
  );
  logWorker(
    `start first-page persisted module=${strategy.module} mid=${payload.mid} inserted=${insertedFirst.length} ranges=${pageRanges.map((r) => `${r.label}:${r.start}-${r.end}`).join(',') || 'none'}`,
  );

  if (
    strategy.module === 'voice_ivr' &&
    !needsIvrDailyAnchor &&
    firstParsed.rows.length > 0 &&
    insertedFirst.length === 0
  ) {
    pageRanges = [];
    pagesToFetch = 1;
  }

  await persistSummary(
    dataSource,
    strategy,
    payload.crmKey,
    payload.mid,
    payload.baseUrl,
    firstParsed.summary,
    firstParsed.summaryMatched,
    totalPages,
    pagesToFetch,
    new Date(),
  );

  await upsertCrawlState(dataSource, payload.crmKey, strategy.module, payload.mid, {
    totalPages: isIncomplete && strategy.module !== 'voice_ivr' ? crawlState.totalPages : totalPages,
    lastCompletedPage:
      isIncomplete && strategy.module !== 'voice_ivr'
        ? crawlState.lastCompletedPage
        : Math.min(1, pagesToFetch),
    status: 'running',
  });

  if (pageRanges.length === 0) {
    await upsertCrawlState(dataSource, payload.crmKey, strategy.module, payload.mid, {
      totalPages,
      status: 'completed',
      lastCompletedPage: pagesToFetch,
      initialCompletedDate: needsIvrDailyAnchor ? ivrBusinessDate : crawlState?.initialCompletedDate,
    });
    return {
      success: true,
      highestCompletedPage: pagesToFetch,
      anchorFound: false,
      stoppedByBoundary: false,
      completedInitialDate: null,
      failedPages: 0,
      module: strategy.module,
      mid: payload.mid,
      totalPages,
      pagesToFetch,
    };
  }

  const batchResult = await runBatch(dataSource, strategy, {
    ...payload,
    module: strategy.module,
    pagesToFetch,
    discoveredTotalPages: totalPages,
    pageRanges,
    initialLastCompletedPage:
      isIncomplete && crawlState ? crawlState.lastCompletedPage : Math.min(1, pagesToFetch),
  } as Required<WorkerPayload>);

  const shouldScheduleHistory =
    batchResult.success &&
    !batchResult.anchorFound &&
    totalPages > VOICE_TABLE_DAILY_MAX_PAGES &&
    batchResult.highestCompletedPage < totalPages &&
    shouldBackfillHistory;
  if (shouldScheduleHistory) {
    const historyUpdate: Partial<VoiceCrawlState> = {
      historyStatus: 'pending',
    };
    // 重启恢复时保留已有历史游标，避免把 3051 之类的断点重置成 dailyCap + 1。
    if (!hasPendingHistory) {
      historyUpdate.historyNextPage = pagesToFetch + 1;
      historyUpdate.historyTotalPagesRef = totalPages;
    }
    await upsertCrawlState(dataSource, payload.crmKey, strategy.module, payload.mid, historyUpdate);
  }

  return {
    ...batchResult,
    module: strategy.module,
    mid: payload.mid,
    totalPages,
    pagesToFetch,
  };
}

async function runBatch(
  dataSource: DataSource,
  strategy: VoiceTableStrategy,
  payload: WorkerPayload,
): Promise<WorkerResult> {
  if (!payload.module) throw new Error('batch payload module missing');
  const module = payload.module;
  const pageRanges = payload.pageRanges ?? [];
  const discoveredTotalPages = payload.discoveredTotalPages ?? 1;
  let highestCompletedPage = payload.initialLastCompletedPage ?? 0;
  const failedPages: number[] = [];
  let anchorFound = false;
  let stoppedByBoundary = false;
  let completedInitialDate: string | null = null;

  for (const range of pageRanges) {
    logWorker(
      `batch range begin module=${module} mid=${payload.mid} label=${range.label} page=${range.start}-${range.end}`,
    );
    const anchorKeys = new Set(range.stopOnAnchorKeys ?? []);
    for (let page = range.start; page <= range.end && !stoppedByBoundary;) {
      const pages: number[] = [];
      while (page <= range.end && pages.length < TABLE_PAGE_CONCURRENCY) {
        pages.push(page);
        page++;
      }

      const results = await Promise.all(
        pages.map(async (currentPage) => {
          try {
            const outcome = await crawlPage(
              dataSource,
              strategy,
              payload,
              currentPage,
              anchorKeys,
            );
            return { page: currentPage, outcome };
          } catch (error) {
            return { page: currentPage, error };
          }
        }),
      );

      results.sort((a, b) => a.page - b.page);

      for (const result of results) {
        if ('error' in result) {
          const message = result.error?.message || String(result.error);
          if (/HTTP (401|403)/.test(message)) {
            await upsertCrawlState(dataSource, payload.crmKey, module, payload.mid, {
              status: 'failed',
            });
            return {
              success: false,
              highestCompletedPage,
              anchorFound,
              stoppedByBoundary,
              completedInitialDate,
              failedPages: failedPages.length,
              error: message,
            };
          }
          failedPages.push(result.page);
          logWorker(
            `batch page-failed module=${module} mid=${payload.mid} page=${result.page} error=${message}`,
          );
          continue;
        }

        const { page: completedPage, outcome } = result;
        highestCompletedPage = Math.max(highestCompletedPage, completedPage);

        if (range.updateCheckpoint) {
          if (completedPage === range.end || completedPage % CHECKPOINT_INTERVAL_PAGES === 0) {
            await upsertCrawlState(dataSource, payload.crmKey, module, payload.mid, {
              lastCompletedPage: highestCompletedPage,
              status: 'running',
            });
          }
        }

        if (completedPage === range.start || completedPage === range.end || completedPage % 10 === 0) {
          logWorker(
            `batch progress module=${module} mid=${payload.mid} label=${range.label} page=${completedPage}/${range.end} inserted=${outcome.insertedCount}`,
          );
        }

        if (range.stopOnAnchorKeys && outcome.containsAnchor) {
          anchorFound = true;
          stoppedByBoundary = true;
          completedInitialDate = range.initialCompletedDate ?? null;
          logWorker(
            `batch anchor-hit module=${module} mid=${payload.mid} label=${range.label} page=${completedPage}`,
          );
          break;
        }

        if (range.stopOnDuplicatePage && outcome.allRowsDuplicate) {
          stoppedByBoundary = true;
          logWorker(
            `batch duplicate-stop module=${module} mid=${payload.mid} label=${range.label} page=${completedPage}`,
          );
          break;
        }
      }

      if (page <= range.end && !stoppedByBoundary) await sleep(PAGE_DELAY_MS);
    }

    if (stoppedByBoundary) break;
    if (range.initialCompletedDate && range.end >= discoveredTotalPages) {
      completedInitialDate = range.initialCompletedDate;
    }
  }

  if (failedPages.length > 0) {
    await upsertCrawlState(dataSource, payload.crmKey, module, payload.mid, {
      totalPages: discoveredTotalPages,
      lastCompletedPage: highestCompletedPage,
      status: 'failed',
    });
    return {
      success: false,
      highestCompletedPage,
      anchorFound,
      stoppedByBoundary,
      completedInitialDate,
      failedPages: failedPages.length,
      error: `failed pages: ${failedPages.join(',')}`,
    };
  }

  await upsertCrawlState(dataSource, payload.crmKey, module, payload.mid, {
    totalPages: discoveredTotalPages,
    lastCompletedPage: highestCompletedPage,
    status: 'completed',
    ...(completedInitialDate ? { initialCompletedDate: completedInitialDate } : {}),
  });

  return {
    success: true,
    highestCompletedPage,
    anchorFound,
    stoppedByBoundary,
    completedInitialDate,
    failedPages: 0,
  };
}

function logWorker(message: string) {
  console.log(message);
}

async function crawlPage(
  dataSource: DataSource,
  strategy: VoiceTableStrategy,
  payload: WorkerPayload,
  page: number,
  anchorKeys: Set<string>,
) {
  const pageUrl = ensurePageIdParam(payload.baseUrl, page);
  const html = await fetchHtmlWithRetry(pageUrl, payload.headers);
  const parsed = strategy.parse(html);
  const inserted = await persistRows(
    dataSource,
    strategy.module,
    payload.crmKey,
    payload.mid,
    payload.baseUrl,
    parsed.rows,
  );

  return {
    insertedCount: inserted.length,
    containsAnchor:
      anchorKeys.size > 0 &&
      rowsContainIvrAnchor(payload.crmKey, payload.mid, parsed.rows, anchorKeys),
    allRowsDuplicate: parsed.rows.length > 0 && inserted.length === 0,
  };
}

async function persistRows(
  dataSource: DataSource,
  module: VoiceModule,
  crmKey: string,
  mid: number,
  sourceUrl: string,
  rows: ParsedRowVoiceIvr[] | ParsedRowVoiceOp[],
): Promise<any[]> {
  if (rows.length === 0) return [];

  if (module === 'voice_ivr') {
    const values = (rows as ParsedRowVoiceIvr[]).map((r) => ({
      id: uuidv4(),
      crmKey,
      mid,
      recordId: r.recordId,
      src: r.src,
      dst: r.dst,
      statusType: r.statusType,
      reason: r.reason,
      task: r.task,
      callDate: r.callDate,
      sourceUrl,
    }));
    const result = await dataSource
      .getRepository(VoiceIvrRecord)
      .createQueryBuilder()
      .insert()
      .into(VoiceIvrRecord)
      .values(values)
      .orIgnore()
      .returning(['id', 'crmKey', 'mid', 'recordId', 'src', 'dst', 'statusType', 'callDate'])
      .execute();
    return (result.raw as any[]) ?? [];
  }

  const values = (rows as ParsedRowVoiceOp[]).map((r) => ({
    id: uuidv4(),
    crmKey,
    mid,
    recordKey: r.recordKey,
    task: r.task,
    src: r.src,
    dst: r.dst,
    agent: r.agent,
    reason: r.reason,
    duration: r.duration,
    callDate: r.callDate,
    endDate: r.endDate,
    sourceUrl,
  }));
  const result = await dataSource
    .getRepository(VoiceOpRecord)
    .createQueryBuilder()
    .insert()
    .into(VoiceOpRecord)
    .values(values)
    .onConflict(
      `("crmKey", mid, src, dst, ("callDate"::date)) WHERE "callDate" IS NOT NULL DO UPDATE SET
        "recordKey" = EXCLUDED."recordKey",
        task = EXCLUDED.task,
        agent = EXCLUDED.agent,
        reason = EXCLUDED.reason,
        duration = EXCLUDED.duration,
        "callDate" = EXCLUDED."callDate",
        "endDate" = EXCLUDED."endDate",
        "sourceUrl" = EXCLUDED."sourceUrl"`,
    )
    .returning(['id', 'crmKey', 'mid', 'recordKey', 'src', 'dst', 'callDate'])
    .execute();
  return (result.raw as any[]) ?? [];
}

async function upsertCrawlState(
  dataSource: DataSource,
  crmKey: string,
  module: VoiceModule,
  mid: number,
  update: Partial<VoiceCrawlState>,
) {
  const result = await dataSource
    .getRepository(VoiceCrawlState)
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
    await dataSource.getRepository(VoiceCrawlState).save({
      id: uuidv4(),
      crmKey,
      module,
      mid,
      totalPages: update.totalPages ?? 1,
      lastCompletedPage: update.lastCompletedPage ?? 0,
      status: update.status ?? 'running',
      initialCompletedDate: update.initialCompletedDate ?? null,
    });
  }
}

async function persistSummary(
  dataSource: DataSource,
  strategy: VoiceTableStrategy,
  crmKey: string,
  mid: number,
  sourceUrl: string,
  summary: any,
  summaryMatched: boolean,
  totalPages: number,
  pagesToFetch: number,
  capturedAt: Date,
) {
  if (!summaryMatched) return;

  if (strategy.module === 'voice_ivr') {
    const repo = dataSource.getRepository(VoiceIvrSummary);
    const last = await repo.findOne({
      where: { crmKey, mid },
      order: { capturedAt: 'DESC' },
    });
    if (
      last &&
      last.totalRecords === summary.totalRecords &&
      last.connectFail === summary.connectFail &&
      last.busy === summary.busy &&
      last.noAnswer === summary.noAnswer &&
      last.connected === summary.connected &&
      last.totalPages === totalPages
    ) {
      await repo.update(last.id, { capturedAt });
      return;
    }
    await repo.save({
      id: uuidv4(),
      crmKey,
      mid,
      totalRecords: summary.totalRecords,
      connectFail: summary.connectFail,
      busy: summary.busy,
      noAnswer: summary.noAnswer,
      connected: summary.connected,
      totalPages,
      sourceUrl,
      capturedAt,
    });
    return;
  }

  const repo = dataSource.getRepository(VoiceOpSummary);
  const last = await repo.findOne({
    where: { crmKey, mid },
    order: { capturedAt: 'DESC' },
  });
  const connectRate = Number(summary.connectRate || 0).toFixed(2);
  const callbackRate = Number(summary.callbackRate || 0).toFixed(2);
  if (
    last &&
    last.totalRecords === summary.totalRecords &&
    last.initCount === summary.initCount &&
    last.ringing === summary.ringing &&
    last.connected === summary.connected &&
    last.agentCount === summary.agentCount &&
    String(last.connectRate) === connectRate &&
    String(last.callbackRate) === callbackRate &&
    last.totalPages === totalPages
  ) {
    await repo.update(last.id, { capturedAt });
    return;
  }
  await repo.save({
    id: uuidv4(),
    crmKey,
    mid,
    totalRecords: summary.totalRecords,
    initCount: summary.initCount,
    ringing: summary.ringing,
    connected: summary.connected,
    agentCount: summary.agentCount,
    connectRate,
    callbackRate,
    totalPages,
    sourceUrl,
    capturedAt,
  });
}

async function getLastTotalPages(
  dataSource: DataSource,
  crmKey: string,
  module: VoiceModule,
  mid: number,
): Promise<number | null> {
  const repo =
    module === 'voice_ivr'
      ? dataSource.getRepository(VoiceIvrSummary)
      : dataSource.getRepository(VoiceOpSummary);
  const last = await repo
    .createQueryBuilder('s')
    .where('s."crmKey" = :crmKey', { crmKey })
    .andWhere('s.mid = :mid', { mid })
    .andWhere('(s."totalRecords" > 0 OR s."totalPages" > 1)')
    .orderBy('s."capturedAt"', 'DESC')
    .getOne();
  return last ? last.totalPages : null;
}

async function fetchIvrTailAnchorKeys(
  dataSource: DataSource,
  strategy: VoiceTableStrategy,
  payload: WorkerPayload,
  totalPages: number,
): Promise<Set<string>> {
  const keys = new Set<string>();
  if (totalPages <= 1) return keys;
  const start = Math.max(2, totalPages - 2 + 1);
  for (let page = start; page <= totalPages; page++) {
    const html = await fetchHtmlWithRetry(
      ensurePageIdParam(payload.baseUrl, page),
      payload.headers,
    );
    const parsed = strategy.parse(html);
    for (const row of parsed.rows as ParsedRowVoiceIvr[]) {
      if (!row.recordId || !row.callDate) continue;
      keys.add(`${payload.crmKey}|${payload.mid}|${formatDateKey(row.callDate)}|${row.recordId}`);
    }
  }
  return keys;
}

function buildResumeRanges(args: {
  lastCompletedPage: number;
  previousTotalPages: number;
  pagesToFetch: number;
}): WorkerPageRange[] {
  const { lastCompletedPage, previousTotalPages, pagesToFetch } = args;
  const deltaPages = Math.max(0, pagesToFetch - previousTotalPages);
  const ranges: WorkerPageRange[] = [];

  if (deltaPages > 0) {
    const frontEnd = Math.min(pagesToFetch, deltaPages + RESUME_OVERLAP_PAGES);
    if (frontEnd >= 2) {
      ranges.push({
        start: 2,
        end: frontEnd,
        label: '补扫最新区',
        updateCheckpoint: false,
      });
    }
  }

  const resumeStart = Math.max(2, lastCompletedPage - RESUME_OVERLAP_PAGES + 1);
  if (resumeStart <= pagesToFetch) {
    ranges.push({
      start: resumeStart,
      end: pagesToFetch,
      label: '断点续抓',
      updateCheckpoint: true,
    });
  }

  return mergePageRanges(ranges);
}

function mergePageRanges(ranges: WorkerPageRange[]): WorkerPageRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: WorkerPageRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end + 1) {
      merged.push({ ...range });
      continue;
    }
    last.end = Math.max(last.end, range.end);
    last.updateCheckpoint = last.updateCheckpoint || range.updateCheckpoint;
    last.label = last.label === range.label ? last.label : `${last.label}+${range.label}`;
  }
  return merged;
}

function getIvrBusinessDate(rows: ParsedRowVoiceIvr[]): string | null {
  for (const row of rows) {
    if (row.callDate) return formatDateKey(row.callDate);
  }
  return null;
}

async function fetchHtmlWithRetry(url: string, headers: Headers): Promise<string> {
  let lastErr: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchHtml(url, headers);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) await sleep(300 * (attempt + 1));
    }
  }
  throw lastErr;
}

function fetchHtml(url: string, headers: Headers): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
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
        res.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (receivedBytes > MAX_VOICE_TABLE_HTML_BYTES) {
            abortedBySize = true;
            req.destroy(
              new Error(
                `response too large: ${receivedBytes} bytes > ${MAX_VOICE_TABLE_HTML_BYTES} bytes`,
              ),
            );
            return;
          }
          chunks.push(chunk);
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
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`request timeout: ${url}`));
    });
    req.end();
  });
}

function rowsContainIvrAnchor(
  crmKey: string,
  mid: number,
  rows: any[],
  anchorKeys: Set<string>,
): boolean {
  for (const row of rows as ParsedRowVoiceIvr[]) {
    if (!row.recordId || !row.callDate) continue;
    const key = `${crmKey}|${mid}|${formatDateKey(row.callDate)}|${row.recordId}`;
    if (anchorKeys.has(key)) return true;
  }
  return false;
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'crm_db',
    entities: [
      VoiceIvrRecord,
      VoiceIvrSummary,
      VoiceOpRecord,
      VoiceOpSummary,
      VoiceCrawlState,
    ],
    synchronize: false,
    logging: false,
  });
}

function sendResult(result: WorkerResult) {
  if (process.send) process.send(result);
  else console.log(JSON.stringify(result));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  sendResult({
    success: false,
    highestCompletedPage: 0,
    anchorFound: false,
    stoppedByBoundary: false,
    completedInitialDate: null,
    failedPages: 0,
    error: err?.message || String(err),
  });
  process.exitCode = 1;
});
