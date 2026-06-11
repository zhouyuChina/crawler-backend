import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

const RETENTION_DAYS = 7;

@Injectable()
export class DataRetentionService implements OnModuleInit {
  private readonly logger = new Logger(DataRetentionService.name);

  constructor(private readonly dataSource: DataSource) {}

  onModuleInit() {
    this.logger.log(`抓取数据保留策略已启用: ${RETENTION_DAYS} 天`);
  }

  /** 每天 03:20 清理 7 天前抓取数据 */
  @Cron('0 20 3 * * *')
  async cleanupOldData() {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const startedAt = Date.now();

    try {
      const results = {
        screenshots: await this.deleteByCreatedAt('screenshots', cutoff),
        webpages: await this.deleteByCreatedAt('webpages', cutoff),
        voiceIvrRecords: await this.deleteByCreatedAt('voice_ivr_records', cutoff),
        voiceOpRecords: await this.deleteByCreatedAt('voice_op_records', cutoff),
        voiceDmOpRecords: await this.deleteByCreatedAt(
          'voice_dm_op_records',
          cutoff,
        ),
        voiceIvrSummaries: await this.deleteByCreatedAt('voice_ivr_summaries', cutoff),
        voiceOpSummaries: await this.deleteByCreatedAt('voice_op_summaries', cutoff),
        voiceDmOpSummaries: await this.deleteByCreatedAt(
          'voice_dm_op_summaries',
          cutoff,
        ),
      };

      this.logger.log(
        `7天数据清理完成 cutoff=${cutoff.toISOString()} elapsed=${Date.now() - startedAt}ms ` +
          JSON.stringify(results),
      );
    } catch (err: any) {
      this.logger.error(`7天数据清理失败: ${err.message}`);
    }
  }

  private async deleteByCreatedAt(tableName: string, cutoff: Date): Promise<number> {
    const result = await this.dataSource.query(
      `DELETE FROM "${tableName}" WHERE "createdAt" < $1`,
      [cutoff],
    );
    return result?.[1] ?? 0;
  }
}
