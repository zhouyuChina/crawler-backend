import { Controller, Get, Param, Query, Res, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { CallRecordService } from './call-record.service';

@Controller('call-records')
export class CallRecordController {
  constructor(private readonly callRecordService: CallRecordService) {}

  @Get('recording')
  async getRecording(
    @Query('url') url: string,
    @Res() res: Response,
  ) {
    if (!url) {
      throw new BadRequestException('缺少 url 参数');
    }

    try {
      new URL(url);
    } catch {
      throw new BadRequestException('无效的 URL 格式');
    }

    this.callRecordService.proxyRecording(url, res);
  }

  @Get()
  async findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('recordType') recordType?: string,
    @Query('full') full?: string,
  ) {
    return this.callRecordService.findAll({
      page: page || 1,
      limit: limit || 20,
      recordType,
      full: full === '1' || full === 'true',
    });
  }

  @Get('latest/:recordType')
  async findLatestByType(
    @Param('recordType') recordType: string,
    @Query('full') full?: string,
    @Query('sourceUrl') sourceUrl?: string,
  ) {
    // 优先从内存快照（调度器轻量 GET 的缓存）返回，避免查 webpages 大表
    if (sourceUrl?.trim()) {
      const cached = this.callRecordService.getLatestRawBody(
        sourceUrl.trim(),
        recordType,
      );
      if (cached) {
        return {
          recordType,
          sourceUrl: sourceUrl.trim(),
          content: cached.rawBody,
          capturedAt: cached.capturedAt,
          source: 'memory',
        };
      }
    } else {
      const cached = this.callRecordService.getLatestRawBodyAcrossCrmKeys(
        recordType,
      );
      if (cached) {
        return {
          recordType,
          sourceUrl: cached.crmKey,
          content: cached.rawBody,
          capturedAt: cached.capturedAt,
          source: 'memory',
        };
      }
    }

    // 内存无数据时回退到数据库查询（向后兼容）
    const record = await this.callRecordService.findLatestByType(recordType, {
      full: full === '1' || full === 'true',
      sourceUrl,
    });

    if (!record) {
      return {
        success: false,
        statusCode: 404,
        message: `暂无 ${recordType} 类型的数据`,
        recordType,
        timestamp: new Date().toISOString(),
        path: `/api/call-records/latest/${recordType}`,
      };
    }

    return record;
  }
}
