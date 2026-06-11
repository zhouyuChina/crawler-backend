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

@Entity('voice_ivr_export_numbers')
@Index(
  'uq_voice_ivr_export_number_daily',
  ['crmKey', 'mid', 'phoneNumber', 'disposition', 'sourceDate'],
  { unique: true },
)
@Index('idx_voice_ivr_export_number_crm_date', [
  'crmKey',
  'sourceDate',
  'disposition',
])
export class VoiceIvrExportNumber {
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

  @Column({ type: 'varchar', length: 32 })
  phoneNumber: string;

  @Column({ type: 'varchar', length: 16 })
  disposition: VoiceIvrExportDisposition;

  /** 北京时间日期，格式 YYYY-MM-DD */
  @Column({ type: 'varchar', length: 10 })
  sourceDate: string;

  @Column({ type: 'text', nullable: true })
  sourceUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
