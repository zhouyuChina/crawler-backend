import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrawlProfile } from './crawl-profile.entity';
import { CrawlProfileController } from './crawl-profile.controller';
import { CrawlProfileService } from './crawl-profile.service';
import { CrmAuthService } from './crm-auth.service';
import { CrmRequestRunnerService } from './crm-request-runner.service';
import { CrmRequestSchedulerService } from './crm-request-scheduler.service';
import { TelegramNotifyService } from './telegram-notify.service';
import { PluginDataModule } from '../plugin-data/plugin-data.module';
import { VoiceTableModule } from '../voice-table/voice-table.module';
import { CallRecordModule } from '../call-record/call-record.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CrawlProfile]),
    forwardRef(() => PluginDataModule),
    VoiceTableModule,
    CallRecordModule,
  ],
  controllers: [CrawlProfileController],
  providers: [
    CrawlProfileService,
    CrmAuthService,
    CrmRequestRunnerService,
    CrmRequestSchedulerService,
    TelegramNotifyService,
  ],
  exports: [CrmAuthService],
})
export class CrawlProfileModule {}
