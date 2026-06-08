import { Injectable, Logger } from '@nestjs/common';
import { PluginDataService } from '../plugin-data/plugin-data.service';
import { VoiceTableService } from '../voice-table/voice-table.service';
import { CrawlProfile } from './crawl-profile.entity';
import { CrmAuthService } from './crm-auth.service';

export type TaskKey =
  | 'get_peer_status'
  | 'get_curcall_in'
  | 'get_curcall_out'
  | 'cont_controler'
  | 'cc_mrcall'
  | 'cc_voiceivr'
  | 'cc_voiceop';

/** 任务定义：间隔(ms)和 URL 生成函数 */
interface TaskDef {
  intervalMs: number;
  buildUrl: (profile: CrawlProfile) => string;
  isTable?: boolean;
}

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
    buildUrl: (p) => {
      const mid = p.mids?.voiceCallStatus ?? 9;
      return `${p.baseUrl}/modules/cc_monitor/cont_controler.php?mid=${mid}&date=${Date.now()}`;
    },
  },
  cc_mrcall: {
    intervalMs: 30000,
    buildUrl: (p) => {
      const mid = p.mids?.concurrentStatus ?? 5;
      return `${p.baseUrl}/modules/cc_mrcall/?mid=${mid}&muser=${encodeURIComponent(p.username)}&st_key=enable&st_type=desc`;
    },
  },
  cc_voiceivr: {
    intervalMs: 5 * 60 * 1000,
    buildUrl: (p) => {
      const mid = p.mids?.voiceRecords ?? 24;
      return `${p.baseUrl}/modules/cc_voiceivr/?mid=${mid}`;
    },
    isTable: true,
  },
  cc_voiceop: {
    intervalMs: 5 * 60 * 1000,
    buildUrl: (p) => {
      const mid = p.mids?.manualRecords ?? 25;
      return `${p.baseUrl}/modules/cc_voiceop/?mid=${mid}`;
    },
    isTable: true,
  },
};

@Injectable()
export class CrmRequestRunnerService {
  private readonly logger = new Logger(CrmRequestRunnerService.name);

  constructor(
    private readonly pluginDataService: PluginDataService,
    private readonly voiceTableService: VoiceTableService,
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
    const headers = {
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      Cookie: cookies,
      Referer: `${profile.baseUrl}/modules/index.php`,
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Upgrade-Insecure-Requests': '1',
    };

    try {
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
        const result = await this.pluginDataService.proxyRequest({
          url,
          method: 'GET',
          headers,
          sourcePluginId: 'crawl-profile-scheduler',
        });
        if ((result.statusCode ?? 0) >= 400) {
          throw new Error(`HTTP ${result.statusCode}: ${url}`);
        }
        this.crmAuthService.touchCookies(profile.id);
        this.logger.debug(`${profile.name}(${taskKey}): 普通请求完成`);
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
}
