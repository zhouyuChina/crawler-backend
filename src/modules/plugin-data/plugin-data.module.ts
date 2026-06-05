import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PluginDataController } from './plugin-data.controller';
import { PluginDataService } from './plugin-data.service';
import { WebpageModule } from '../webpage/webpage.module';
import { ScreenshotModule } from '../screenshot/screenshot.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { CallRecordModule } from '../call-record/call-record.module';
import { CrawlProfileModule } from '../crawl-profile/crawl-profile.module';

@Module({
  imports: [
    ConfigModule,
    WebpageModule,
    ScreenshotModule,
    WebsocketModule,
    CallRecordModule,
    forwardRef(() => CrawlProfileModule),
  ],
  controllers: [PluginDataController],
  providers: [PluginDataService],
  exports: [PluginDataService],
})
export class PluginDataModule {}
