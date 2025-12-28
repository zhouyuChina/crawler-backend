import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Screenshot } from './entities/screenshot.entity';
import { ScreenshotService } from './screenshot.service';
import { ScreenshotController } from './screenshot.controller';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [TypeOrmModule.forFeature([Screenshot]), StorageModule, ConfigModule],
  controllers: [ScreenshotController],
  providers: [ScreenshotService],
  exports: [ScreenshotService],
})
export class ScreenshotModule {}
