import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
  BeforeInsert,
} from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

@Entity('voice_ivr_records')
@Index(
  'uq_voice_ivr_record_with_call_date',
  ['crmKey', 'mid', 'recordId', 'callDate'],
  {
    unique: true,
    where: '"callDate" IS NOT NULL',
  },
)
@Index(
  'uq_voice_ivr_record_without_call_date',
  ['crmKey', 'mid', 'recordId'],
  {
    unique: true,
    where: '"callDate" IS NULL',
  },
)
@Index('idx_voice_ivr_record_crm_mid_created', [
  'crmKey',
  'mid',
  'createdAt',
])
export class VoiceIvrRecord {
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

  @Column({ type: 'varchar', length: 64 })
  recordId: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  src: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  dst: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  statusType: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  task: string | null;

  @Column({ type: 'timestamp', nullable: true })
  callDate: Date | null;

  @Column({ type: 'text', nullable: true })
  sourceUrl: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
