import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CrawlContent =
  | 'voiceCallStatus'
  | 'concurrentStatus'
  | 'voiceRecords'
  | 'manualRecords';

export type AuthStatus =
  | 'unknown'
  | 'ok'
  | 'login_failed'
  | 'human_check_required';

@Entity('crawl_profiles')
export class CrawlProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  name: string;

  /** e.g. http://173.234.2.174:55668 */
  @Column({ length: 255 })
  baseUrl: string;

  @Column({ length: 100 })
  username: string;

  /** 明文存储（第一版），页面返回时脱敏 */
  @Column({ length: 255 })
  password: string;

  @Column({ default: false })
  enabled: boolean;

  /** 勾选的抓取内容 */
  @Column({ type: 'jsonb', default: '[]' })
  contents: CrawlContent[];

  /**
   * 各模块 mid，默认实测值：
   *   voiceCallStatus=9, concurrentStatus=5, voiceRecords=24, manualRecords=25
   */
  @Column({
    type: 'jsonb',
    default: '{"voiceCallStatus":9,"concurrentStatus":5,"voiceRecords":24,"manualRecords":25}',
  })
  mids: Record<string, number>;

  @Column({
    type: 'varchar',
    length: 30,
    default: 'unknown',
  })
  authStatus: AuthStatus;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastRunAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
