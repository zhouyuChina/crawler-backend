import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { Webpage } from '../webpage/entities/webpage.entity';
import { WebsocketGateway } from '../websocket/websocket.gateway';

@Injectable()
export class CallRecordService {
  // URL 关键词映射
  private readonly RECORD_TYPE_KEYWORDS = {
    get_peer_status: 'get_peer_status',
    cont_controler: 'cont_controler',
    get_curcall_in: 'get_curcall_in',
    get_curcall_out: 'get_curcall_out',
  };

  // 通话类型（需要判断结束状态的）
  private readonly CALL_TYPES = ['get_curcall_in', 'get_curcall_out'];

  // 记录最后更新时间
  private lastUpdateTimes = new Map<string, Date>();

  // 记录每种类型的最新内容（用于去重）
  private lastRecordContents = new Map<string, string>();

  constructor(
    @InjectRepository(Webpage)
    private webpageRepository: Repository<Webpage>,
    private websocketGateway: WebsocketGateway,
  ) {}

  /**
   * 从 HTML 内容中提取被叫号码
   */
  private extractCalledNumber(htmlContent: string): string | null {
    if (!htmlContent) return null;

    // 匹配 HTML 表格中的被叫号码（第二个 <td> 标签中的内容）
    // 示例：<td align="center">0402117300</td>
    const rows = htmlContent.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi);
    if (!rows || rows.length < 2) return null;

    // 跳过表头，从第二行开始（第一个数据行）
    const dataRow = rows[1];
    const cells = dataRow.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);

    if (cells && cells.length >= 2) {
      // 第二个 <td> 是被叫号码
      const calledNumberCell = cells[1];
      const numberMatch = calledNumberCell.match(/>([^<]+)</);
      if (numberMatch && numberMatch[1]) {
        return numberMatch[1].trim();
      }
    }

    return null;
  }

  /**
   * 查询列表（分页）- 按被叫号码去重，只保留最新记录
   */
  async findAll(params: {
    page: number;
    limit: number;
    recordType?: string;
  }) {
    const { page, limit, recordType } = params;

    // 第一步：查询所有符合条件的记录
    const queryBuilder = this.webpageRepository.createQueryBuilder('webpage');

    // 如果指定了 recordType，按 URL 关键词过滤
    if (recordType && this.RECORD_TYPE_KEYWORDS[recordType]) {
      queryBuilder.andWhere('webpage.url LIKE :url', {
        url: `%${this.RECORD_TYPE_KEYWORDS[recordType]}%`,
      });
    }

    // 排除包含 "無任何通話記錄" 的记录
    queryBuilder.andWhere(
      '(webpage.content NOT LIKE :excludeText AND webpage.htmlContent NOT LIKE :excludeText) OR (webpage.content IS NULL AND webpage.htmlContent IS NULL)',
      { excludeText: '%無任何通話記錄%' },
    );

    // 按创建时间倒序排列（最新的在前）
    queryBuilder.orderBy('webpage.createdAt', 'DESC');

    const allItems = await queryBuilder.getMany();

    // 第二步：按被叫号码去重，保留每个号码的最新记录
    const uniqueRecordsMap = new Map<string, any>();

    for (const item of allItems) {
      const content = item.htmlContent || item.content || '';
      const calledNumber = this.extractCalledNumber(content);

      // 如果提取到被叫号码，且该号码还未记录，则保存（因为已按时间倒序，第一次出现的就是最新的）
      if (calledNumber && !uniqueRecordsMap.has(calledNumber)) {
        uniqueRecordsMap.set(calledNumber, item);
      }
    }

    // 转换为数组
    const uniqueItems = Array.from(uniqueRecordsMap.values());

    // 第三步：分页
    const total = uniqueItems.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedItems = uniqueItems.slice(startIndex, endIndex);

    return {
      items: paginatedItems,
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

  /**
   * 记录通话更新时间
   */
  recordCallUpdate(recordType: string, webpageId: string) {
    const key = `${recordType}:${webpageId}`;
    this.lastUpdateTimes.set(key, new Date());
  }

  /**
   * 判断是否应该广播此记录（去重逻辑）
   * @param recordType 记录类型
   * @param content 记录内容
   * @param webpageId 当前记录 ID
   * @returns true 表示应该广播，false 表示重复跳过
   */
  async shouldBroadcastRecord(
    recordType: string,
    content: string,
    webpageId: string,
  ): Promise<boolean> {
    const lastContent = this.lastRecordContents.get(recordType);

    // 如果内容与上次相同，则跳过广播
    if (lastContent === content) {
      return false;
    }

    // 更新最新内容
    this.lastRecordContents.set(recordType, content);
    return true;
  }

  /**
   * 定时任务：每秒检查通话是否结束
   * 如果超过 3 秒没有新的更新，认为通话已结束
   */
  @Cron('*/1 * * * * *') // 每秒执行
  async checkCallStatus() {
    const threeSecondsAgo = new Date(Date.now() - 3000);

    // 检查每个通话类型的最新记录
    for (const callType of this.CALL_TYPES) {
      const latestRecord = await this.findLatestByType(callType);

      if (!latestRecord) {
        continue;
      }

      const key = `${callType}:${latestRecord.id}`;
      const lastUpdate = this.lastUpdateTimes.get(key);

      // 如果有记录更新时间，且超过 3 秒没更新
      if (lastUpdate && lastUpdate < threeSecondsAgo) {
        console.log(`📞 通话已结束: ${callType} (${latestRecord.id})`);

        // 推送通话结束事件
        this.websocketGateway.broadcastCallStatusChanged({
          id: latestRecord.id,
          recordType: callType,
          status: 'ended',
          parsedData: null,
          timestamp: new Date().toISOString(),
        });

        // 清理记录
        this.lastUpdateTimes.delete(key);
      }
      // 如果记录是最近创建的（3秒内），但没有更新记录，标记为活跃
      else if (!lastUpdate && latestRecord.createdAt > threeSecondsAgo) {
        this.lastUpdateTimes.set(key, latestRecord.createdAt);
      }
    }
  }
}
