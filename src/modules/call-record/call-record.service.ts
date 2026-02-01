import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import {
  Repository,
  Between,
  LessThanOrEqual,
  MoreThanOrEqual,
  LessThan,
} from 'typeorm';
import { CallRecord } from './entities/call-record.entity';
import { CreateCallRecordDto } from './dto/create-call-record.dto';
import { QueryCallRecordDto } from './dto/query-call-record.dto';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import * as crypto from 'crypto';

@Injectable()
export class CallRecordService {
  constructor(
    @InjectRepository(CallRecord)
    private readonly callRecordRepository: Repository<CallRecord>,
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway: WebsocketGateway,
  ) {}

  /**
   * 创建通话记录
   */
  async create(dto: CreateCallRecordDto): Promise<CallRecord> {
    const record = this.callRecordRepository.create(dto);
    return await this.callRecordRepository.save(record);
  }

  /**
   * 查询列表（分页）
   */
  async findAll(dto: QueryCallRecordDto) {
    const { page = 1, limit = 10, recordType, startDate, endDate } = dto;

    const where: any = {};

    if (recordType) {
      where.recordType = recordType;
    }

    if (startDate && endDate) {
      where.createdAt = Between(new Date(startDate), new Date(endDate));
    } else if (startDate) {
      where.createdAt = MoreThanOrEqual(new Date(startDate));
    } else if (endDate) {
      where.createdAt = LessThanOrEqual(new Date(endDate));
    }

    const [items, total] = await this.callRecordRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * 查询单条记录
   */
  async findOne(id: string): Promise<CallRecord | null> {
    return await this.callRecordRepository.findOne({ where: { id } });
  }

  /**
   * 查询最新记录（按类型）
   */
  async findLatestByType(recordType: string): Promise<CallRecord | null> {
    return await this.callRecordRepository.findOne({
      where: { recordType },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 查询上一条记录（按类型和 ID）
   */
  async findPreviousByType(
    recordType: string,
    currentId: string,
    limit: number = 1,
  ): Promise<CallRecord[]> {
    return await this.callRecordRepository
      .createQueryBuilder('record')
      .where('record.recordType = :recordType', { recordType })
      .andWhere('record.id != :currentId', { currentId })
      .orderBy('record.createdAt', 'DESC')
      .take(limit)
      .getMany();
  }

  /**
   * 删除记录
   */
  async remove(id: string): Promise<void> {
    await this.callRecordRepository.delete(id);
  }

  /**
   * 数据变更检测
   */
  async hasDataChanged(
    recordType: string,
    responseBody: string,
  ): Promise<{ changed: boolean; hash: string }> {
    const newHash = this.calculateHash(responseBody);
    const latestRecord = await this.findLatestByType(recordType);

    const changed = !latestRecord || latestRecord.dataHash !== newHash;

    return { changed, hash: newHash };
  }

  /**
   * 计算哈希值
   */
  private calculateHash(data: string): string {
    return crypto.createHash('md5').update(data).digest('hex');
  }

  /**
   * 统计数据
   */
  async getStatistics() {
    const total = await this.callRecordRepository.count();

    // 按类型统计
    const byTypeResult = await this.callRecordRepository
      .createQueryBuilder('record')
      .select('record.recordType', 'recordType')
      .addSelect('COUNT(*)', 'count')
      .groupBy('record.recordType')
      .getRawMany();

    const byType: Record<string, number> = {};
    byTypeResult.forEach((item) => {
      byType[item.recordType] = parseInt(item.count, 10);
    });

    // 今天的记录数
    const today = await this.callRecordRepository.count({
      where: {
        createdAt: MoreThanOrEqual(new Date(new Date().setHours(0, 0, 0, 0))),
      },
    });

    // 最近一小时的记录数
    const oneHourAgo = new Date(Date.now() - 3600000);
    const lastHour = await this.callRecordRepository.count({
      where: {
        createdAt: MoreThanOrEqual(oneHourAgo),
      },
    });

    return {
      totalRecords: total,
      byType,
      today,
      lastHour,
    };
  }

  /**
   * 创建或更新记录（UPSERT）
   * 用于 get_curcall_in 和 get_curcall_out 的持续更新
   */
  async upsertByKey(
    recordType: string,
    uniqueKey: string,
    dto: CreateCallRecordDto,
  ): Promise<CallRecord> {
    // 查找现有记录
    const existing = await this.callRecordRepository.findOne({
      where: {
        recordType,
        metadata: {
          uniqueKey,
        } as any,
      },
    });

    if (existing) {
      // 更新现有记录
      if (dto.responseBody !== undefined) {
        existing.responseBody = dto.responseBody;
      }
      existing.parsedData = dto.parsedData;
      if (dto.dataHash !== undefined) {
        existing.dataHash = dto.dataHash;
      }
      if (dto.statusCode !== undefined) {
        existing.statusCode = dto.statusCode;
      }
      existing.lastUpdateTime = new Date();
      existing.status = 'active'; // 重置为 active

      return await this.callRecordRepository.save(existing);
    } else {
      // 创建新记录
      const record = this.callRecordRepository.create({
        ...dto,
        status: 'active',
        lastUpdateTime: new Date(),
      });

      return await this.callRecordRepository.save(record);
    }
  }

  /**
   * 定时任务：每秒检查并更新通话状态
   * 只处理通话记录（get_curcall_in, get_curcall_out），不处理状态记录
   */
  @Cron('*/1 * * * * *') // 每秒执行
  async updateCallStatus(): Promise<void> {
    const threeSecondsAgo = new Date(Date.now() - 3000);

    // 查找超过 3 秒未更新的 active 通话记录（只处理通话类型）
    const expiredRecords = await this.callRecordRepository
      .createQueryBuilder('record')
      .where('record.status = :status', { status: 'active' })
      .andWhere('record.lastUpdateTime < :threeSecondsAgo', { threeSecondsAgo })
      .andWhere('record.recordType IN (:...callTypes)', {
        callTypes: ['get_curcall_in', 'get_curcall_out'],
      })
      .getMany();

    if (expiredRecords.length === 0) {
      return;
    }

    console.log(`🔍 发现 ${expiredRecords.length} 条通话已结束`);

    // 批量更新状态为 ended
    for (const record of expiredRecords) {
      record.status = 'ended';
      await this.callRecordRepository.save(record);

      // 推送 WebSocket 事件
      if (this.websocketGateway?.broadcastCallStatusChanged) {
        this.websocketGateway.broadcastCallStatusChanged({
          id: record.id,
          recordType: record.recordType,
          status: 'ended',
          parsedData: record.parsedData,
          timestamp: new Date().toISOString(),
        });
      }

      console.log(`✅ 通话已结束: ${record.id} (${record.recordType})`);
    }
  }

  /**
   * 定时任务：每 10 秒清理已结束的通话
   * 已禁用：保留所有记录到数据库，不自动删除
   */
  // @Cron('*/10 * * * * *') // 已禁用
  async cleanupEndedCalls(): Promise<void> {
    // 已禁用自动清理功能
    // 所有通话记录将永久保存在数据库中
    return;

    /* 原始清理逻辑（已禁用）
    const sixtySecondsAgo = new Date(Date.now() - 60000);

    // 删除超过 60 秒的已结束通话（只删除通话类型）
    const result = await this.callRecordRepository
      .createQueryBuilder()
      .delete()
      .where('status = :status', { status: 'ended' })
      .andWhere('lastUpdateTime < :sixtySecondsAgo', { sixtySecondsAgo })
      .andWhere('recordType IN (:...callTypes)', {
        callTypes: ['get_curcall_in', 'get_curcall_out'],
      })
      .execute();

    if (result.affected && result.affected > 0) {
      console.log(`🗑️ 清理了 ${result.affected} 条已结束的通话记录`);
    }
    */
  }
}
