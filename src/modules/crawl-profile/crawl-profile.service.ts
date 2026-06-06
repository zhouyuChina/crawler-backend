import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrawlProfile } from './crawl-profile.entity';
import { CreateCrawlProfileDto } from './dto/create-crawl-profile.dto';
import { UpdateCrawlProfileDto } from './dto/update-crawl-profile.dto';
import { CrmAuthService } from './crm-auth.service';
import {
  buildTaskKeys,
  CrmRequestSchedulerService,
} from './crm-request-scheduler.service';
import { CrmRequestRunnerService } from './crm-request-runner.service';

const DEFAULT_MIDS = {
  voiceCallStatus: 9,
  concurrentStatus: 5,
  voiceRecords: 24,
  manualRecords: 25,
};

@Injectable()
export class CrawlProfileService {
  private readonly logger = new Logger(CrawlProfileService.name);
  /** 防止同一 profile 重复 run-once 堆叠 */
  private readonly runOnceInFlight = new Set<string>();

  constructor(
    @InjectRepository(CrawlProfile)
    private readonly repo: Repository<CrawlProfile>,
    private readonly crmAuthService: CrmAuthService,
    private readonly scheduler: CrmRequestSchedulerService,
    private readonly runner: CrmRequestRunnerService,
  ) {}

  async findAll(): Promise<CrawlProfile[]> {
    const profiles = await this.repo.find({ order: { createdAt: 'ASC' } });
    return profiles.map((p) => this.sanitize(p));
  }

  async findOne(id: string): Promise<CrawlProfile> {
    const p = await this.repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException(`CrawlProfile ${id} not found`);
    return this.sanitize(p);
  }

  async create(dto: CreateCrawlProfileDto): Promise<CrawlProfile> {
    const entity = this.repo.create({
      ...dto,
      contents: dto.contents ?? [],
      mids: { ...DEFAULT_MIDS, ...(dto.mids ?? {}) },
      enabled: dto.enabled ?? false,
      authStatus: 'unknown',
    });
    const saved = await this.repo.save(entity);
    this.scheduler.refreshProfilesCache();
    return this.sanitize(saved);
  }

  async update(id: string, dto: UpdateCrawlProfileDto): Promise<CrawlProfile> {
    const existing = await this.repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException(`CrawlProfile ${id} not found`);

    const updated = this.repo.merge(existing, dto);
    const saved = await this.repo.save(updated);

    // 密码或地址变化时清空 Cookie 缓存，并重置 authStatus
    if (dto.password || dto.baseUrl || dto.username) {
      this.crmAuthService.invalidateCookies(id);
      await this.repo.update(id, { authStatus: 'unknown' });
    }

    this.scheduler.invalidateProfile(id);
    this.scheduler.refreshProfilesCache();
    return this.sanitize(saved);
  }

  async setEnabled(id: string, enabled: boolean): Promise<CrawlProfile> {
    const existing = await this.repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException(`CrawlProfile ${id} not found`);

    await this.repo.update(id, { enabled });
    this.scheduler.invalidateProfile(id);
    this.scheduler.refreshProfilesCache();
    return this.sanitize({ ...existing, enabled });
  }

  async remove(id: string): Promise<void> {
    const existing = await this.repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException(`CrawlProfile ${id} not found`);
    await this.repo.delete(id);
    this.crmAuthService.invalidateCookies(id);
    this.scheduler.invalidateProfile(id);
  }

  async testLogin(id: string): Promise<{ success: boolean; message: string }> {
    const profile = await this.repo.findOne({ where: { id } });
    if (!profile) throw new NotFoundException(`CrawlProfile ${id} not found`);

    const result = await this.crmAuthService.forceLogin(profile);
    return {
      success: result.success,
      message: result.error ?? (result.success ? '登录成功' : '登录失败'),
    };
  }

  async runOnce(
    id: string,
  ): Promise<{
    accepted: boolean;
    tasks: string[];
    message: string;
  }> {
    const profile = await this.repo.findOne({ where: { id } });
    if (!profile) throw new NotFoundException(`CrawlProfile ${id} not found`);

    if (this.runOnceInFlight.has(id)) {
      return {
        accepted: false,
        tasks: [],
        message: '该配置正在执行中，请稍候再试',
      };
    }

    const taskKeys = buildTaskKeys(profile.contents ?? []);
    if (taskKeys.length === 0) {
      return {
        accepted: false,
        tasks: [],
        message: '未勾选任何抓取内容',
      };
    }

    this.runOnceInFlight.add(id);
    void this.runTasksInBackground(profile, taskKeys).finally(() => {
      this.runOnceInFlight.delete(id);
    });

    return {
      accepted: true,
      tasks: taskKeys,
      message: `已触发 ${taskKeys.length} 个任务，后台执行中（首次可能需登录 CRM，请查看服务端日志）`,
    };
  }

  private async runTasksInBackground(
    profile: CrawlProfile,
    taskKeys: ReturnType<typeof buildTaskKeys>,
  ): Promise<void> {
    const triggered: string[] = [];
    const skipped: string[] = [];

    for (const taskKey of taskKeys) {
      try {
        await this.runner.runTask(profile, taskKey);
        triggered.push(taskKey);
      } catch (err: any) {
        skipped.push(taskKey);
        this.logger.warn(
          `run-once ${profile.name}(${taskKey}) 失败: ${err?.message ?? err}`,
        );
      }
    }

    this.logger.log(
      `run-once 完成 ${profile.name}: 成功 ${triggered.length} [${triggered.join(', ')}], 失败 ${skipped.length}${skipped.length ? ` [${skipped.join(', ')}]` : ''}`,
    );
  }

  /** 脱敏密码 */
  private sanitize(p: CrawlProfile): CrawlProfile {
    return { ...p, password: '••••••••' };
  }
}
