import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  BeforeInsert,
} from 'typeorm';
import { Screenshot } from '../../screenshot/entities/screenshot.entity';
import { v4 as uuidv4 } from 'uuid';

@Entity('webpages')
export class Webpage {
  @PrimaryColumn('uuid')
  id: string;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
  }

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
