import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Screenshot } from '../../screenshot/entities/screenshot.entity';

@Entity('webpages')
export class Webpage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 500 })
  url: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  title: string;

  @Column({ type: 'text', nullable: true })
  content: string;

  @Column({ type: 'text', nullable: true })
  htmlContent: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  domain: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: {
    description?: string;
    keywords?: string[];
    author?: string;
    ogImage?: string;
  };

  @Column({ type: 'varchar', length: 100, nullable: true })
  sourcePluginId: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  browserType: string;

  @OneToMany(() => Screenshot, (screenshot) => screenshot.webpage)
  screenshots: Screenshot[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  capturedAt: Date;
}
