import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { Webpage } from '../webpage/entities/webpage.entity';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import * as http from 'http';
import * as https from 'https';
import type { Response } from 'express';
import { createHash } from 'crypto';

const CALL_RECORD_PREVIEW_CHARS = 64 * 1024;
const CALL_RECORD_SCAN_LIMIT = 1000;

@Injectable()
export class CallRecordService {
  private readonly logger = new Logger(CallRecordService.name);

  // URL 关键词映射
  private readonly RECORD_TYPE_KEYWORDS = {
    get_peer_status: 'get_peer_status',
    cont_controler: 'cont_controler',
    get_curcall_in: 'get_curcall_in',
    get_curcall_out: 'get_curcall_out',
  };

  // 通话类型（需要判断结束状态的）
  private readonly CALL_TYPES = ['get_curcall_in', 'get_curcall_out'];

  // 只跟踪仍在进行中的通话，避免空闲时仍然持续扫库
  private activeCalls = new Map<
    string,
    {
      webpageId: string;
      lastUpdate: Date;
    }
  >();

  // 记录每种类型的最新内容 hash（用于去重，避免常驻保存完整 HTML）
  private lastRecordContentHashes = new Map<string, string>();

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
    full?: boolean;
  }) {
    const { page, limit, recordType, full } = params;

    // 第一步：查询符合条件的记录。默认只取 preview，避免高频接口把历史大 HTML 拉进 Node 堆。
    const queryBuilder = this.webpageRepository.createQueryBuilder('webpage');
    if (!full) {
      this.selectPreviewColumns(queryBuilder);
      queryBuilder.setParameter('previewLimit', CALL_RECORD_PREVIEW_CHARS);
      queryBuilder.limit(CALL_RECORD_SCAN_LIMIT);
    }

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

    const allItems = full
      ? await queryBuilder.getMany()
      : (await queryBuilder.getRawMany()).map((row) => this.mapPreviewRow(row));
    const maxContentChars = allItems.reduce((max, item) => {
      const content = item.htmlContent || item.content || '';
      return Math.max(max, content.length);
    }, 0);
    this.logger.warn(
      `[mem-diagnose] call-records list recordType=${recordType ?? 'all'} full=${Boolean(full)} rows=${allItems.length} maxContentChars=${maxContentChars} heap=${formatMemoryUsage()}`,
    );

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
  async findLatestByType(
    recordType: string,
    options: { full?: boolean; sourceUrl?: string } = {},
  ): Promise<Partial<Webpage> | null> {
    const keyword = this.RECORD_TYPE_KEYWORDS[recordType];

    if (!keyword) {
      return null;
    }

    const queryBuilder = this.webpageRepository.createQueryBuilder('webpage');
    if (!options.full) {
      this.selectPreviewColumns(queryBuilder);
      queryBuilder.setParameter('previewLimit', CALL_RECORD_PREVIEW_CHARS);
    }
    queryBuilder.where('webpage.url LIKE :url', { url: `%${keyword}%` });

    const sourceUrl = options.sourceUrl?.trim();
    if (sourceUrl) {
      queryBuilder.andWhere(
        "webpage.url LIKE :sourceUrlPrefix ESCAPE '\\'",
        {
          sourceUrlPrefix: `${this.escapeLikePattern(sourceUrl)}%`,
        },
      );
    }

    // 排除包含 "無任何通話記錄" 的记录
    queryBuilder.andWhere(
      '(webpage.content NOT LIKE :excludeText AND webpage.htmlContent NOT LIKE :excludeText) OR (webpage.content IS NULL AND webpage.htmlContent IS NULL)',
      { excludeText: '%無任何通話記錄%' },
    );

    queryBuilder.orderBy('webpage.createdAt', 'DESC');

    if (options.full) {
      const record = await queryBuilder.getOne();
      this.logger.warn(
        `[mem-diagnose] call-records latest recordType=${recordType} sourceUrl=${sourceUrl || 'all'} full=true contentChars=${this.getRecordContentLength(record)} heap=${formatMemoryUsage()}`,
      );
      return record;
    }

    const row = await queryBuilder.getRawOne();
    const record = row ? this.mapPreviewRow(row) : null;
    this.logger.warn(
      `[mem-diagnose] call-records latest recordType=${recordType} sourceUrl=${sourceUrl || 'all'} full=false contentChars=${this.getRecordContentLength(record)} heap=${formatMemoryUsage()}`,
    );
    return record;
  }

  private escapeLikePattern(value: string): string {
    return value.replace(/[\\%_]/g, (char) => `\\${char}`);
  }

  private selectPreviewColumns(queryBuilder: any) {
    queryBuilder
      .select('webpage.id', 'id')
      .addSelect('webpage.url', 'url')
      .addSelect('webpage.title', 'title')
      .addSelect(
        'SUBSTRING(webpage.content FROM 1 FOR :previewLimit)',
        'content',
      )
      .addSelect(
        'SUBSTRING(webpage."htmlContent" FROM 1 FOR :previewLimit)',
        'htmlContent',
      )
      .addSelect('webpage.domain', 'domain')
      .addSelect('webpage.metadata', 'metadata')
      .addSelect('webpage."sourcePluginId"', 'sourcePluginId')
      .addSelect('webpage."browserType"', 'browserType')
      .addSelect('webpage."createdAt"', 'createdAt')
      .addSelect('webpage."updatedAt"', 'updatedAt')
      .addSelect('webpage."capturedAt"', 'capturedAt');
  }

  private mapPreviewRow(row: any): Partial<Webpage> {
    return {
      id: row.id,
      url: row.url,
      title: row.title,
      content: row.content,
      htmlContent: row.htmlContent,
      domain: row.domain,
      metadata: row.metadata,
      sourcePluginId: row.sourcePluginId,
      browserType: row.browserType,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      capturedAt: row.capturedAt,
    };
  }

  private getRecordContentLength(record: Partial<Webpage> | null): number {
    if (!record) return 0;
    return (record.htmlContent || record.content || '').length;
  }

  /**
   * 记录通话更新时间
   */
  recordCallUpdate(recordType: string, webpageId: string) {
    if (!this.CALL_TYPES.includes(recordType)) {
      return;
    }

    this.activeCalls.set(recordType, {
      webpageId,
      lastUpdate: new Date(),
    });
  }

  /**
   * 重复轮询不落库时，仍刷新通话心跳，避免前端误判通话结束。
   */
  recordCallHeartbeat(recordType: string) {
    if (!this.CALL_TYPES.includes(recordType)) {
      return;
    }

    const activeCall = this.activeCalls.get(recordType);
    if (!activeCall) {
      return;
    }

    activeCall.lastUpdate = new Date();
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
    // 如果内容包含 "無任何通話記錄"，则跳过广播
    if (content && content.includes('無任何通話記錄')) {
      return false;
    }

    const contentHash = this.hashContent(content);
    const lastContentHash = this.lastRecordContentHashes.get(recordType);

    // 如果内容与上次相同，则跳过广播
    if (lastContentHash === contentHash) {
      return false;
    }

    // 更新最新内容 hash
    this.lastRecordContentHashes.set(recordType, contentHash);
    return true;
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * 定时任务：每秒检查通话是否结束
   * 如果超过 3 秒没有新的更新，认为通话已结束
   */
  @Cron('*/1 * * * * *') // 每秒执行
  async checkCallStatus() {
    if (this.activeCalls.size === 0) {
      return;
    }

    const threeSecondsAgo = new Date(Date.now() - 3000);

    for (const [callType, activeCall] of this.activeCalls.entries()) {
      if (activeCall.lastUpdate < threeSecondsAgo) {
        console.log(`📞 通话已结束: ${callType} (${activeCall.webpageId})`);

        // 推送通话结束事件
        this.websocketGateway.broadcastCallStatusChanged({
          id: activeCall.webpageId,
          recordType: callType,
          status: 'ended',
          parsedData: null,
          timestamp: new Date().toISOString(),
        });

        this.activeCalls.delete(callType);
      }
    }
  }

  /**
   * 代理录音文件：从 PBX 系统流式转发录音到前端
   */
  proxyRecording(recordingUrl: string, res: Response): void {
    const url = new URL(recordingUrl);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      timeout: 60000,
    };

    const req = client.request(options, (upstream) => {
      if (upstream.statusCode && upstream.statusCode >= 400) {
        res.status(upstream.statusCode).json({
          success: false,
          message: `录音文件请求失败，上游返回 ${upstream.statusCode}`,
        });
        return;
      }

      // 透传上游响应头
      if (upstream.headers['content-type']) {
        res.setHeader('Content-Type', upstream.headers['content-type']);
      }
      if (upstream.headers['content-length']) {
        res.setHeader('Content-Length', upstream.headers['content-length']);
      }
      if (upstream.headers['content-disposition']) {
        res.setHeader(
          'Content-Disposition',
          upstream.headers['content-disposition'],
        );
      }

      // 流式转发
      upstream.pipe(res);
    });

    req.on('error', (error) => {
      if (!res.headersSent) {
        res.status(502).json({
          success: false,
          message: `录音文件请求失败: ${error.message}`,
        });
      }
    });

    req.on('timeout', () => {
      req.destroy();
      if (!res.headersSent) {
        res.status(504).json({
          success: false,
          message: '录音文件请求超时',
        });
      }
    });

    req.end();
  }
}

function formatMemoryUsage(): string {
  const { heapUsed, heapTotal, rss } = process.memoryUsage();
  const mb = 1024 * 1024;
  return `${(heapUsed / mb).toFixed(1)}/${(heapTotal / mb).toFixed(1)}MB rss=${(
    rss / mb
  ).toFixed(1)}MB`;
}
