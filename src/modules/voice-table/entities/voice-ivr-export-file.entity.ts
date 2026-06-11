import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  BeforeInsert,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

export type VoiceIvrExportDisposition = '接通' | '未接通';

@Entity('voice_ivr_export_files')
@Index(
  'uq_voice_ivr_export_file_daily',
  ['crmKey', 'mid', 'disposition', 'sourceDate'],
  { unique: true },
)
@Index('idx_voice_ivr_export_file_crm_date', [
  'crmKey',
  'sourceDate',
  'disposition',
])
export class VoiceIvrExportFile {
  @PrimaryColumn('uuid')
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
  }

  @Column({ type: 'varchar', length: 128 })
  crmKey: string;

  @Column({ type: 'integer' })
  mid: number;

  @Column({ type: 'varchar', length: 16 })
  disposition: VoiceIvrExportDisposition;

  /** 北京时间日期，格式 YYYY-MM-DD */
  @Column({ type: 'varchar', length: 10 })
  sourceDate: string;

  @Column({ type: 'text' })
  filePath: string;

  @Column({ type: 'integer', default: 0 })
  lineCount: number;

  @Column({ type: 'varchar', length: 64 })
  contentHash: string;

  @Column({ type: 'text', nullable: true })
  sourceUrl: string | null;

  @Column({ type: 'timestamp' })
  capturedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
