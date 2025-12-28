import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Webpage } from '../../webpage/entities/webpage.entity';

@Entity('screenshots')
export class Screenshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 500 })
  filename: string;

  @Column({ type: 'varchar', length: 500 })
  filepath: string;

  @Column({ type: 'varchar', length: 100 })
  mimetype: string;

  @Column({ type: 'bigint' })
  size: number;

  @Column({ type: 'int', nullable: true })
  width: number;

  @Column({ type: 'int', nullable: true })
  height: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  storageType: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  publicUrl: string;

  @ManyToOne(() => Webpage, (webpage) => webpage.screenshots, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'webpageId' })
  webpage: Webpage;

  @Column({ type: 'uuid' })
  webpageId: string;

  @CreateDateColumn()
  createdAt: Date;
}
