import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  Between,
  LessThanOrEqual,
  MoreThanOrEqual,
} from 'typeorm';
import { CallRecord } from './entities/call-record.entity';
import { CreateCallRecordDto } from './dto/create-call-record.dto';
import { QueryCallRecordDto } from './dto/query-call-record.dto';
import * as crypto from 'crypto';

@Injectable()
export class CallRecordService {
  constructor(
    @InjectRepository(CallRecord)
    private readonly callRecordRepository: Repository<CallRecord>,
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
}
