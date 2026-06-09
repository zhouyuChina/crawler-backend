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

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const PAGE_DELAY_MS = 200;
const CHECKPOINT_INTERVAL_PAGES = 50;
const MAX_VOICE_TABLE_HTML_BYTES = 2 * 1024 * 1024;

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
  crmKey: string;
  module: VoiceModule;
  mid: number;
  baseUrl: string;
  headers: Headers;
  pagesToFetch: number;
  discoveredTotalPages: number;
  pageRanges: WorkerPageRange[];
  initialLastCompletedPage: number;
}

interface WorkerResult {
  success: boolean;
  highestCompletedPage: number;
  anchorFound: boolean;
  stoppedByBoundary: boolean;
  completedInitialDate: string | null;
  failedPages: number;
  error?: string;
}

async function main() {
  const payloadRaw = process.env.VOICE_TABLE_WORKER_PAYLOAD;
  if (!payloadRaw) throw new Error('VOICE_TABLE_WORKER_PAYLOAD missing');

  const payload = JSON.parse(payloadRaw) as WorkerPayload;
  const strategy = resolveStrategy(payload.baseUrl);
  if (!strategy || strategy.module !== payload.module) {
    throw new Error(`unsupported worker url/module: ${payload.baseUrl}`);
  }

  const dataSource = await createDataSource().initialize();
  try {
    const result = await runBatch(dataSource, strategy, payload);
    sendResult(result);
  } finally {
    await dataSource.destroy();
  }
}

async function runBatch(
  dataSource: DataSource,
  strategy: VoiceTableStrategy,
  payload: WorkerPayload,
): Promise<WorkerResult> {
  const failedPages: number[] = [];
  let highestCompletedPage = payload.initialLastCompletedPage;
  let anchorFound = false;
  let stoppedByBoundary = false;
  let completedInitialDate: string | null = null;

  for (const range of payload.pageRanges) {
    const anchorKeys = new Set(range.stopOnAnchorKeys ?? []);
    for (let page = range.start; page <= range.end; page++) {
      try {
        const outcome = await crawlPage(dataSource, strategy, payload, page, anchorKeys);

        if (range.updateCheckpoint) {
          highestCompletedPage = Math.max(highestCompletedPage, page);
          if (page === range.end || page % CHECKPOINT_INTERVAL_PAGES === 0) {
            await upsertCrawlState(dataSource, payload.crmKey, payload.module, payload.mid, {
              lastCompletedPage: highestCompletedPage,
              status: 'running',
            });
          }
        }

        if (range.stopOnAnchorKeys && outcome.containsAnchor) {
          anchorFound = true;
          stoppedByBoundary = true;
          completedInitialDate = range.initialCompletedDate ?? null;
          break;
        }

        if (range.stopOnDuplicatePage && outcome.allRowsDuplicate) {
          stoppedByBoundary = true;
          break;
        }
      } catch (err: any) {
        const message = err?.message || String(err);
        if (/HTTP (401|403)/.test(message)) {
          await upsertCrawlState(dataSource, payload.crmKey, payload.module, payload.mid, {
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
        failedPages.push(page);
      }

      if (page < range.end) await sleep(PAGE_DELAY_MS);
    }

    if (stoppedByBoundary) break;
    if (range.initialCompletedDate && range.end >= payload.discoveredTotalPages) {
      completedInitialDate = range.initialCompletedDate;
    }
  }

  if (failedPages.length > 0) {
    await upsertCrawlState(dataSource, payload.crmKey, payload.module, payload.mid, {
      totalPages: payload.discoveredTotalPages,
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

  await upsertCrawlState(dataSource, payload.crmKey, payload.module, payload.mid, {
    totalPages: payload.discoveredTotalPages,
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
