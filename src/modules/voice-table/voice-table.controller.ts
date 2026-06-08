import { Body, Controller, Post } from '@nestjs/common';
import { CrawlStartResult, VoiceTableService } from './voice-table.service';
import { TableCrawlDto } from './dto/table-crawl.dto';

@Controller('plugin')
export class VoiceTableController {
  constructor(private readonly service: VoiceTableService) {}

  @Post('table-crawl')
  async tableCrawl(@Body() dto: TableCrawlDto): Promise<CrawlStartResult> {
    const result = await this.service.startCrawl({
      profileId: dto.profileId,
      url: dto.url,
      headers: dto.headers,
    });
    return result;
  }
}
