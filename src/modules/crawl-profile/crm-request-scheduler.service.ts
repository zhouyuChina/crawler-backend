import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrawlProfile, CrawlContent } from './crawl-profile.entity';
import {
  CrmRequestRunnerService,
  TaskKey,
} from './crm-request-runner.service';
import { CrmAuthService } from './crm-auth.service';

/** 内存中对每个 (profileId:taskKey) 的调度状态 */
interface TaskState {
  lastRunAt: number;
  running: boolean;
}

/** 根据勾选内容推导出需要运行的任务列表（已去重） */
export function buildTaskKeys(contents: CrawlContent[]): TaskKey[] {
  const keys = new Set<TaskKey>();

  if (contents.length === 0) return [];

  // get_peer_status：只要有任何内容勾选就启用一路（全局去重）
  keys.add('get_peer_status');

  if (contents.includes('voiceCallStatus')) {
    keys.add('get_curcall_in');
    keys.add('get_curcall_out');
    keys.add('cont_controler');
  }

  // cc_mrcall 已停用：保留 concurrentStatus 配置字段，当前不再派发该任务

  if (contents.includes('voiceRecords')) {
    keys.add('cc_voiceivr');
  }

  if (contents.includes('manualRecords')) {
    keys.add('cc_voiceop');
  }

  if (contents.includes('handDialRecords')) {
    keys.add('dm_voiceop');
  }

  return Array.from(keys);
}

@Injectable()
export class CrmRequestSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrmRequestSchedulerService.name);
  private readonly stateMap = new Map<string, TaskState>();
  private memoryProbeTimer?: NodeJS.Timeout;

  /** 强制开关：为 true 时在非营业时段也继续调度，15:10 自动重置 */
  private forceEnabled = false;

  constructor(
    @InjectRepository(CrawlProfile)
    private readonly profileRepo: Repository<CrawlProfile>,
    private readonly runner: CrmRequestRunnerService,
    private readonly crmAuthService: CrmAuthService,
  ) {}

  onModuleInit() {
    this.crmAuthService.registerCookiesSyncedCallback((id) =>
      this.invalidateProfile(id),
    );
    this.crmAuthService.registerAuthStatusChangedCallback(() =>
      this.refreshProfilesCache(),
    );
    this.memoryProbeTimer = setInterval(() => {
      const runningTasks = Array.from(this.stateMap.values()).filter(
        (state) => state.running,
      ).length;
      const { heapUsed, heapTotal, rss } = process.memoryUsage();
      const mb = 1024 * 1024;
      this.logger.warn(
        `[mem-probe] scheduler ${JSON.stringify({
          heap: `${(heapUsed / mb).toFixed(1)}/${(heapTotal / mb).toFixed(1)}MB rss=${(rss / mb).toFixed(1)}MB`,
          stateMapSize: this.stateMap.size,
          runningTasks,
          cachedProfiles: this.cachedProfiles.length,
        })}`,
      );
    }, 5_000);
    this.memoryProbeTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.memoryProbeTimer) clearInterval(this.memoryProbeTimer);
    this.stateMap.clear();
  }

  /**
   * 每 500ms 扫描一次，决定哪些任务到了执行时间
   * 500ms 是最小颗粒度（get_curcall_in 600ms），足够精度
   */
  @Cron('*/1 * * * * *')
  async tick() {
    if (!this.forceEnabled && !this.isWithinBusinessHours()) return;

    const profiles = await this.getEnabledProfiles();
    if (profiles.length === 0) return;

    const now = Date.now();

    for (const profile of profiles) {
      if (profile.authStatus === 'login_failed') {
        continue;
      }
      if (
        profile.authStatus === 'human_check_required' &&
        !this.crmAuthService.hasValidCookies(profile.id)
      ) {
        continue;
      }

      const taskKeys = buildTaskKeys(profile.contents ?? []);

      for (const taskKey of taskKeys) {
        const def = this.runner.getTaskDef(taskKey);
        if (!def) continue;

        const stateKey = `${profile.id}:${taskKey}`;
        const state = this.stateMap.get(stateKey) ?? {
          lastRunAt: 0,
          running: false,
        };

        if (state.running) continue;
        if (now - state.lastRunAt < def.intervalMs) continue;

        // 更新状态，异步执行
        state.running = true;
        state.lastRunAt = now;
        this.stateMap.set(stateKey, state);

        this.executeTask(profile, taskKey, stateKey);
      }
    }

    // 更新数据库 lastRunAt（粗粒度，每次 tick 如有启用配置就更新）
  }

  /** 北京时间 15:10 自动关闭强制开关 */
  @Cron('0 10 15 * * *', { timeZone: 'Asia/Shanghai' })
  autoDisableForce() {
    if (this.forceEnabled) {
      this.forceEnabled = false;
      this.logger.log('强制开关已在 15:10 (BJT) 自动关闭');
    }
  }

  /** 设置强制开关，返回当前状态快照（供 Controller 响应） */
  setForceEnabled(value: boolean): { forceEnabled: boolean; isBusinessHours: boolean } {
    this.forceEnabled = value;
    this.logger.log(`强制开关 → ${value}`);
    return { forceEnabled: this.forceEnabled, isBusinessHours: this.isWithinBusinessHours() };
  }

  /** 返回当前调度状态快照 */
  getSchedulerStatus(): { forceEnabled: boolean; isBusinessHours: boolean } {
    return { forceEnabled: this.forceEnabled, isBusinessHours: this.isWithinBusinessHours() };
  }

  /** 通知调度器某个 profile 的配置已变更（立即生效） */
  invalidateProfile(profileId: string) {
    this.profilesCacheAt = 0;
    for (const key of this.stateMap.keys()) {
      if (key.startsWith(`${profileId}:`)) {
        this.stateMap.delete(key);
      }
    }
  }

  /** 配置列表变更后刷新启用配置缓存 */
  refreshProfilesCache() {
    this.profilesCacheAt = 0;
  }

  private executeTask(
    profile: CrawlProfile,
    taskKey: TaskKey,
    stateKey: string,
  ) {
    this.runner
      .runTask(profile, taskKey)
      .catch((err) => {
        this.logger.warn(
          `任务异常 ${stateKey}: ${err.message}`,
        );
      })
      .finally(() => {
        const s = this.stateMap.get(stateKey);
        if (s) s.running = false;
        // 更新数据库 lastRunAt
        void this.profileRepo.update(profile.id, {
          lastRunAt: new Date(),
          lastError:
            this.stateMap.get(stateKey)?.running === false
              ? null
              : undefined,
        });
      });
  }

  private cachedProfiles: CrawlProfile[] = [];
  private profilesCacheAt = 0;
  private readonly PROFILE_CACHE_TTL = 10_000;

  private async getEnabledProfiles(): Promise<CrawlProfile[]> {
    const now = Date.now();
    if (now - this.profilesCacheAt < this.PROFILE_CACHE_TTL) {
      return this.cachedProfiles;
    }
    this.cachedProfiles = await this.profileRepo.find({
      where: { enabled: true },
    });
    this.profilesCacheAt = now;
    return this.cachedProfiles;
  }

  /**
   * 判断当前是否在北京时间营业时段（08:45 - 15:10）
   * 直接用 UTC 偏移 +8 计算，无需 moment-timezone 等三方库
   */
  private isWithinBusinessHours(): boolean {
    const now = new Date();
    const bjTotalMin = ((now.getUTCHours() + 8) % 24) * 60 + now.getUTCMinutes();
    return bjTotalMin >= 8 * 60 + 45 && bjTotalMin < 15 * 60 + 10;
  }
}
