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

/**
 * 记录每个 (module + mid) 的分页抓取进度，支持断点续抓。
 * - 每次开始抓取时 status → 'running'，lastCompletedPage 记录已完成的最大页
 * - 全部页完成后 status → 'completed'
 * - 进程中断（重启后检测）保持 'running'，下次启动会从 lastCompletedPage+1 续抓
 */
@Entity('voice_crawl_states')
@Unique('uq_voice_crawl_state', ['module', 'mid'])
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

  @UpdateDateColumn()
  updatedAt: Date;
}
