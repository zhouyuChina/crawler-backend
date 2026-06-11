import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
  BeforeInsert,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

@Entity('voice_dm_op_summaries')
@Index('idx_voice_dm_op_summary_crm_mid_captured', [
  'crmKey',
  'mid',
  'capturedAt',
])
export class VoiceDmOpSummary {
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
  crmKey: string;

  @Column({ type: 'integer', default: 0 })
  totalRecords: number;

  @Column({ type: 'integer', default: 0 })
  initCount: number;

  @Column({ type: 'integer', default: 0 })
  ringing: number;

  @Column({ type: 'integer', default: 0 })
  connected: number;

  @Column({ type: 'integer', default: 0 })
  agentCount: number;

  @Column({ type: 'numeric', precision: 6, scale: 2, default: 0 })
  connectRate: string;

  @Column({ type: 'numeric', precision: 6, scale: 2, default: 0 })
  callbackRate: string;

  @Column({ type: 'integer', default: 0 })
  totalPages: number;

  @Column({ type: 'text', nullable: true })
  sourceUrl: string;

  @Column({ type: 'timestamp' })
  capturedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}

