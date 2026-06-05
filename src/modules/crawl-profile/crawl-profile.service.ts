import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrawlProfile } from './crawl-profile.entity';
import { CreateCrawlProfileDto } from './dto/create-crawl-profile.dto';
import { UpdateCrawlProfileDto } from './dto/update-crawl-profile.dto';
import { CrmAuthService } from './crm-auth.service';
import { CrmRequestSchedulerService } from './crm-request-scheduler.service';
import { CrmRequestRunnerService, TaskKey } from './crm-request-runner.service';

const DEFAULT_MIDS = {
  voiceCallStatus: 9,
  concurrentStatus: 5,
  voiceRecords: 24,
  manualRecords: 25,
};

@Injectable()
export class CrawlProfileService {
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
  ): Promise<{ triggered: string[]; skipped: string[]; message: string }> {
    const profile = await this.repo.findOne({ where: { id } });
    if (!profile) throw new NotFoundException(`CrawlProfile ${id} not found`);

    const allTasks: TaskKey[] = [
      'get_peer_status',
      'get_curcall_in',
      'get_curcall_out',
      'cont_controler',
      'cc_mrcall',
      'cc_voiceivr',
      'cc_voiceop',
    ];

    const triggered: string[] = [];
    const skipped: string[] = [];

    for (const taskKey of allTasks) {
      try {
        await this.runner.runTask(profile, taskKey);
        triggered.push(taskKey);
      } catch {
        skipped.push(taskKey);
      }
    }

    return {
      triggered,
      skipped,
      message: `触发 ${triggered.length} 个任务，跳过 ${skipped.length} 个`,
    };
  }

  /** 脱敏密码 */
  private sanitize(p: CrawlProfile): CrawlProfile {
    return { ...p, password: '••••••••' };
  }
}
