import { Body, Controller, Get, Post, Query } from '@nestjs/common';
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
}
