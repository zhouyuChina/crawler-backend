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

  if (contents.includes('concurrentStatus')) {
    keys.add('cc_mrcall');
  }

  if (contents.includes('voiceRecords')) {
    keys.add('cc_voiceivr');
  }

  if (contents.includes('manualRecords')) {
    keys.add('cc_voiceop');
  }

  return Array.from(keys);
}

@Injectable()
export class CrmRequestSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrmRequestSchedulerService.name);
  private readonly stateMap = new Map<string, TaskState>();

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
  }

  onModuleDestroy() {
    this.stateMap.clear();
  }

  /**
   * 每 500ms 扫描一次，决定哪些任务到了执行时间
   * 500ms 是最小颗粒度（get_curcall_in 600ms），足够精度
   */
  @Cron('*/1 * * * * *')
  async tick() {
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
}
