import { BadRequestException, Body, Controller, Get, NotFoundException, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CrawlStartResult, VoiceTableService } from './voice-table.service';
import { TableCrawlDto } from './dto/table-crawl.dto';

@Controller('plugin')
export class VoiceTableController {
  constructor(private readonly service: VoiceTableService) {}

  @Post('table-crawl')
  async tableCrawl(@Body() dto: TableCrawlDto): Promise<CrawlStartResult> {
    const result = await this.service.startCrawl({
      crmKey: dto.crmKey,
      url: dto.url,
      headers: dto.headers,
    });
    return result;
  }

  @Get('ivr-export-files')
  async getIvrExportFiles(
    @Query('crmKey') crmKey: string,
    @Query('sourceDate') sourceDate?: string,
  ) {
    return this.service.getIvrExportFiles(crmKey, sourceDate);
  }

  @Get('ivr-export-file/download')
  async downloadIvrExportFile(
    @Query('crmKey') crmKey: string,
    @Query('sourceDate') sourceDate: string,
    @Query('disposition') disposition: string,
    @Res() res: Response,
  ) {
    if (!crmKey) throw new BadRequestException('缺少 crmKey');
    if (!sourceDate) throw new BadRequestException('缺少 sourceDate');
    if (!disposition) throw new BadRequestException('缺少 disposition');

    const result = await this.service.getIvrExportFileContent({
      crmKey,
      sourceDate,
      disposition,
    });

    if (!result) {
      throw new NotFoundException(
        `未找到文件: crmKey=${crmKey} date=${sourceDate} disposition=${disposition}`,
      );
    }

    const safeDate = sourceDate.replace(/[^0-9-]/g, '');
    const safeDispo = disposition === 'connected' ? 'connected' : 'not_connected';
    const filename = `ivr-${safeDate}-${safeDispo}.txt`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(result);
  }

  @Get('voice-op-daily')
  async getVoiceOpDailyData(
    @Query('crmKey') crmKey: string,
    @Query('date') date: string,
    @Query('module') module: 'voice_op' | 'voice_dm_op' = 'voice_op',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getVoiceOpDailyData({
      crmKey,
      date,
      module,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }
}
