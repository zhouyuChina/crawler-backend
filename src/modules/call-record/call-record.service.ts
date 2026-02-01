import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Webpage } from '../webpage/entities/webpage.entity';

@Injectable()
export class CallRecordService {
  // URL 关键词映射
  private readonly RECORD_TYPE_KEYWORDS = {
    get_peer_status: 'get_peer_status',
    cont_controler: 'cont_controler',
    get_curcall_in: 'get_curcall_in',
    get_curcall_out: 'get_curcall_out',
  };

  constructor(
    @InjectRepository(Webpage)
    private webpageRepository: Repository<Webpage>,
  ) {}

  /**
   * 查询列表（分页）
   */
  async findAll(params: {
    page: number;
    limit: number;
    recordType?: string;
  }) {
    const { page, limit, recordType } = params;
    const where: any = {};

    // 如果指定了 recordType，按 URL 关键词过滤
    if (recordType && this.RECORD_TYPE_KEYWORDS[recordType]) {
      where.url = Like(`%${this.RECORD_TYPE_KEYWORDS[recordType]}%`);
    }

    const [items, total] = await this.webpageRepository.findAndCount({
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
   * 查询最新记录（按类型）
   */
  async findLatestByType(recordType: string): Promise<Webpage | null> {
    const keyword = this.RECORD_TYPE_KEYWORDS[recordType];

    if (!keyword) {
      return null;
    }

    return await this.webpageRepository.findOne({
      where: {
        url: Like(`%${keyword}%`),
      },
      order: { createdAt: 'DESC' },
    });
  }
}
