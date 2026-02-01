import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PluginDataController } from './plugin-data.controller';
import { PluginDataService } from './plugin-data.service';
import { WebpageModule } from '../webpage/webpage.module';
import { ScreenshotModule } from '../screenshot/screenshot.module';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [
    ConfigModule,
    WebpageModule,
    ScreenshotModule,
    WebsocketModule,
  ],
  controllers: [PluginDataController],
  providers: [PluginDataService],
})
export class PluginDataModule {}
