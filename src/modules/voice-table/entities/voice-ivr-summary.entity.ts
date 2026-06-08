import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
  BeforeInsert,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

@Entity('voice_ivr_summaries')
@Index('idx_voice_ivr_summary_crm_mid_captured', [
  'crmProfileId',
  'mid',
  'capturedAt',
])
export class VoiceIvrSummary {
  @PrimaryColumn('uuid')
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
  }

  @Column({ type: 'integer' })
  mid: number;

  @Column({ type: 'varchar', length: 128, default: 'legacy' })
  crmProfileId: string;

  @Column({ type: 'integer', default: 0 })
  totalRecords: number;

  @Column({ type: 'integer', default: 0 })
  connectFail: number;

  @Column({ type: 'integer', default: 0 })
  busy: number;

  @Column({ type: 'integer', default: 0 })
  noAnswer: number;

  @Column({ type: 'integer', default: 0 })
  connected: number;

  @Column({ type: 'integer', default: 0 })
  totalPages: number;

  @Column({ type: 'text', nullable: true })
  sourceUrl: string;

  @Column({ type: 'timestamp' })
  capturedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
