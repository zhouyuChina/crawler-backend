import {
  Entity,
  PrimaryColumn,
  Column,
  Unique,
  UpdateDateColumn,
  BeforeInsert,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

export type CrawlStateStatus = 'running' | 'completed' | 'failed';
export type HistoryCrawlStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * 记录每个 (crmKey + module + mid) 的分页抓取进度，支持断点续抓。
 * - 每次开始抓取时 status → 'running'，lastCompletedPage 记录已完成的最大页
 * - 全部页完成后 status → 'completed'
 * - 进程中断（重启后检测）保持 'running'，下次启动会从 lastCompletedPage+1 续抓
 */
@Entity('voice_crawl_states')
@Unique('uq_voice_crawl_state', ['crmKey', 'module', 'mid'])
export class VoiceCrawlState {
  @PrimaryColumn('uuid')
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
  }

  /** voice_ivr | voice_op */
  @Column({ type: 'varchar', length: 16 })
  module: string;

  @Column({ type: 'varchar', length: 128, default: 'legacy' })
  crmKey: string;

  @Column({ type: 'integer' })
  mid: number;

  /** 本次（或最近一次）抓取发现的总页数 */
  @Column({ type: 'integer', default: 1 })
  totalPages: number;

  /** 已成功完成的最大页码（0 表示尚未完成任何页） */
  @Column({ type: 'integer', default: 0 })
  lastCompletedPage: number;

  @Column({ type: 'varchar', length: 16, default: 'completed' })
  status: CrawlStateStatus;

  /** IVR 每日锚点全量完成日期，格式 YYYY-MM-DD */
  @Column({ type: 'varchar', length: 10, nullable: true })
  initialCompletedDate: string | null;

  // ── 历史补全游标字段 ────────────────────────────────────────────────────────

  /** pending=待续跑 running=批次进行中 completed=全部完成 failed=批次失败 */
  @Column({ type: 'varchar', length: 16, nullable: true })
  historyStatus: HistoryCrawlStatus | null;

  /**
   * 下次历史批次起始页码（以 historyTotalPagesRef 为基准，使用前需加页码漂移量）。
   * 日常扫描触碰 VOICE_TABLE_DAILY_MAX_PAGES 时写入。
   */
  @Column({ type: 'integer', nullable: true })
  historyNextPage: number | null;

  /** 上次批次结束时的总页数，用于计算新增记录导致的页码漂移 */
  @Column({ type: 'integer', nullable: true })
  historyTotalPagesRef: number | null;

  /** 上次批次最后一条记录的 recordId（备用对齐，漂移计算偏差较大时使用） */
  @Column({ type: 'varchar', length: 128, nullable: true })
  historyLastRecordId: string | null;

  /** 上次历史批次开始时间 */
  @Column({ type: 'timestamp', nullable: true })
  historyBatchStartedAt: Date | null;

  /** 上次历史批次结束时间 */
  @Column({ type: 'timestamp', nullable: true })
  historyBatchFinishedAt: Date | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
