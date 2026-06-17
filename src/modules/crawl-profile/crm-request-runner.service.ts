import { Injectable, Logger } from '@nestjs/common';
import { VoiceTableService } from '../voice-table/voice-table.service';
import { CallRecordService } from '../call-record/call-record.service';
import { CrawlProfile } from './crawl-profile.entity';
import { CrmAuthService } from './crm-auth.service';
import * as http from 'http';
import * as https from 'https';
import * as zlib from 'zlib';

export type TaskKey =
  | 'get_peer_status'
  | 'get_curcall_in'
  | 'get_curcall_out'
  | 'cont_controler'
  | 'cc_mrcall'
  | 'cc_voiceivr'
  | 'cc_voiceivr_initial_refresh'
  | 'cc_voiceop'
  | 'dm_voiceop';

/** 任务定义：间隔(ms)和 URL 生成函数 */
interface TaskDef {
  intervalMs: number;
  buildUrl: (profile: CrawlProfile) => string;
  isTable?: boolean;
}

type Headers = Record<string, string>;

const SCHEDULER_REQUEST_TIMEOUT_MS = 30000;
const SCHEDULER_RESPONSE_DRAIN_LIMIT_BYTES = 2 * 1024 * 1024;
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

const TASK_DEFS: Record<TaskKey, TaskDef> = {
  get_peer_status: {
    intervalMs: 5000,
    buildUrl: (p) =>
      `${p.baseUrl}/modules/get_peer_status.php?date=${Date.now()}`,
  },
  get_curcall_in: {
    intervalMs: 600,
    buildUrl: (p) =>
      `${p.baseUrl}/modules/cc_monitor/get_curcall_in.php?date=${Date.now()}`,
  },
  get_curcall_out: {
    intervalMs: 1200,
    buildUrl: (p) =>
      `${p.baseUrl}/modules/cc_monitor/get_curcall_out.php?date=${Date.now()}`,
  },
  cont_controler: {
    intervalMs: 20000,
    buildUrl: (p) =>
      `${p.baseUrl}/modules/cc_monitor/cont_controler.php?muser=${encodeURIComponent(p.username)}&max=100&st_key=enable&st_type=desc&date=${Date.now()}&campnum=0`,
  },
  cc_mrcall: {
    intervalMs: 30000,
    buildUrl: (p) => {
      const mid = p.mids?.concurrentStatus ?? 5;
      return `${p.baseUrl}/modules/cc_mrcall/?mid=${mid}&muser=${encodeURIComponent(p.username)}&st_key=enable&st_type=desc`;
    },
  },
  cc_voiceivr: {
    intervalMs: 3 * 60 * 1000,
    buildUrl: (p) => `${p.baseUrl}/modules/cc_voiceivr/`,
  },
  cc_voiceivr_initial_refresh: {
    intervalMs: 60 * 1000,
    buildUrl: (p) => {
      const mid = p.mids?.voiceRecords ?? 24;
      return `${p.baseUrl}/modules/cc_voiceivr/?mid=${mid}`;
    },
  },
  cc_voiceop: {
    intervalMs: 3 * 60 * 1000,
    buildUrl: (p) => {
      const mid = p.mids?.manualRecords ?? 25;
      return `${p.baseUrl}/modules/cc_voiceop/?mid=${mid}`;
    },
    isTable: true,
  },
  dm_voiceop: {
    intervalMs: 3 * 60 * 1000,
    buildUrl: (p) => {
      const mid = p.mids?.manualRecords ?? 25;
      return `${p.baseUrl}/modules/dm_voiceop/?mid=${mid}`;
    },
    isTable: true,
  },
};

@Injectable()
export class CrmRequestRunnerService {
  private readonly logger = new Logger(CrmRequestRunnerService.name);

  constructor(
    private readonly voiceTableService: VoiceTableService,
    private readonly callRecordService: CallRecordService,
    private readonly crmAuthService: CrmAuthService,
  ) {}

  /** 执行一次指定任务 */
  async runTask(profile: CrawlProfile, taskKey: TaskKey): Promise<void> {
    const def = TASK_DEFS[taskKey];
    if (!def) return;

    const cookies = await this.crmAuthService.getCookies(profile);
    if (!cookies) {
      this.logger.warn(
        `${profile.name}(${taskKey}): 无法获取 Cookie，跳过此次执行`,
      );
      return;
    }

    const url = def.buildUrl(profile);
    const headers = this.buildBrowserLikeHeaders(profile, taskKey, cookies);

    try {
      if (taskKey === 'cc_voiceivr') {
        const result = await this.voiceTableService.crawlIvrExportNumbers({
          crmKey: profile.baseUrl,
          mid: profile.mids?.voiceRecords ?? 24,
          url,
          headers,
        });
        if (!result.success) {
          throw new Error(result.message || 'ivr export crawl failed');
        }
        this.crmAuthService.touchCookies(profile.id);
        this.logger.debug(
          `${profile.name}(${taskKey}): IVR 导出号码 接通=${result.connected} 未接通=${result.notConnected}`,
        );
        return;
      }

      if (taskKey === 'cc_voiceivr_initial_refresh') {
        const result = await this.voiceTableService.refreshInitialIvrRecords({
          crmKey: profile.baseUrl,
          url,
          headers,
        });
        if (!result.success) {
          throw new Error(result.message || 'ivr initial refresh failed');
        }
        this.crmAuthService.touchCookies(profile.id);
        if (result.processed > 0) {
          this.logger.debug(
            `${profile.name}(${taskKey}): 初始状态补偿 ${result.processed} 个 dst`,
          );
        }
        return;
      }

      if (def.isTable) {
        const result = await this.voiceTableService.startCrawl({
          crmKey: profile.baseUrl,
          url,
          headers,
        });
        if (!result.success) {
          throw new Error(result.message || 'table crawl failed');
        }
        this.crmAuthService.touchCookies(profile.id);
        this.logger.debug(`${profile.name}(${taskKey}): 表格抓取已触发`);
      } else {
        const { statusCode, body, setCookies } = await this.runLightweightGet(
          url,
          headers,
        );
        if (statusCode >= 400) {
          throw new Error(`HTTP ${statusCode}: ${url}`);
        }
        this.crmAuthService.updateCookiesFromSetCookie(profile.id, setCookies);
        // 推送原始响应体到内存快照，并通过 WS 实时广播
        this.callRecordService.pushRawRecord(profile.baseUrl, taskKey, body);
      }
    } catch (err: any) {
      // Cookie 可能过期，下次重新登录
      if (
        err.message?.includes('302') ||
        err.message?.includes('HTTP 401') ||
        err.message?.includes('HTTP 403') ||
        err.message?.includes('login') ||
        err.message?.includes('unauthorized')
      ) {
        this.crmAuthService.invalidateCookies(profile.id);
      }
      this.logger.warn(`${profile.name}(${taskKey}) 执行失败: ${err.message}`);
      throw err;
    }
  }

  getTaskDef(taskKey: TaskKey): TaskDef | undefined {
    return TASK_DEFS[taskKey];
  }

  private buildBrowserLikeHeaders(
    profile: CrawlProfile,
    taskKey: TaskKey,
    cookies: string,
  ): Headers {
    const headers: Headers = {
      Accept: '*/*',
      Cookie: cookies,
      Referer: this.getBrowserReferer(profile, taskKey),
      'User-Agent': BROWSER_USER_AGENT,
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Accept-Encoding': 'gzip, deflate',
    };

    if (this.isDocumentLikeTask(taskKey)) {
      headers.Accept =
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
      headers['Upgrade-Insecure-Requests'] = '1';
    }

    return headers;
  }

  private getBrowserReferer(profile: CrawlProfile, taskKey: TaskKey): string {
    switch (taskKey) {
      case 'get_curcall_in':
        return `${profile.baseUrl}/modules/cc_monitor/curcall_in.php`;
      case 'get_curcall_out':
        return `${profile.baseUrl}/modules/cc_monitor/curcall_out.php`;
      case 'cont_controler':
        return `${profile.baseUrl}/modules/cc_monitor/controler.php`;
      default:
        return `${profile.baseUrl}/modules/index.php`;
    }
  }

  private isDocumentLikeTask(taskKey: TaskKey): boolean {
    return (
      taskKey === 'cc_mrcall' ||
      taskKey === 'cc_voiceivr' ||
      taskKey === 'cc_voiceivr_initial_refresh' ||
      taskKey === 'cc_voiceop' ||
      taskKey === 'dm_voiceop'
    );
  }
  private decodeResponseBody(
    buffer: Buffer,
    contentEncoding: string,
    allowCompressedFallback: boolean,
  ): string {
    try {
      if (contentEncoding.includes('gzip')) {
        return zlib.gunzipSync(buffer).toString('utf8');
      }
      if (contentEncoding.includes('deflate')) {
        return zlib.inflateSync(buffer).toString('utf8');
      }
    } catch (err) {
      if (!allowCompressedFallback) {
        throw err;
      }
    }

    return buffer.toString('utf8');
  }

  private runLightweightGet(
    url: string,
    headers: Headers,
  ): Promise<{ statusCode: number; body: string; setCookies: string[] }> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const client = isHttps ? https : http;
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      let settled = false;
      const settle = (
        result: { statusCode: number; body: string; setCookies: string[] } | null,
        err?: Error,
      ) => {
        if (settled) return;
        settled = true;
        if (result !== null) resolve(result);
        else reject(err);
      };

      const req = client.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers,
          timeout: SCHEDULER_REQUEST_TIMEOUT_MS,
        },
        (res) => {
          const statusCode = res.statusCode || 0;
          const setCookies = (res.headers['set-cookie'] ?? []) as string[];
          const contentEncoding = String(
            res.headers['content-encoding'] ?? '',
          ).toLowerCase();
          const buildBody = (allowCompressedFallback: boolean) =>
            this.decodeResponseBody(
              Buffer.concat(chunks),
              contentEncoding,
              allowCompressedFallback,
            );

          res.on('data', (chunk: Buffer) => {
            receivedBytes += chunk.length;
            chunks.push(chunk);
            if (receivedBytes > SCHEDULER_RESPONSE_DRAIN_LIMIT_BYTES) {
              // 超大响应：截断并立刻 settle，然后销毁连接
              req.destroy();
              settle({
                statusCode,
                body: buildBody(true),
                setCookies,
              });
            }
          });
          res.on('end', () => {
            settle({
              statusCode,
              body: buildBody(false),
              setCookies,
            });
          });
        },
      );
      req.on('error', (err) => settle(null, err));
      req.on('timeout', () => {
        req.destroy(new Error(`scheduler request timeout: ${url}`));
      });
      req.end();
    });
  }
}
