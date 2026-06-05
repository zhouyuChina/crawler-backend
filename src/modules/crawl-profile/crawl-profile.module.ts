import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrawlProfile } from './crawl-profile.entity';
import { CrawlProfileController } from './crawl-profile.controller';
import { CrawlProfileService } from './crawl-profile.service';
import { CrmAuthService } from './crm-auth.service';
import { CrmRequestRunnerService } from './crm-request-runner.service';
import { CrmRequestSchedulerService } from './crm-request-scheduler.service';
import { PluginDataModule } from '../plugin-data/plugin-data.module';
import { VoiceTableModule } from '../voice-table/voice-table.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CrawlProfile]),
    forwardRef(() => PluginDataModule),
    VoiceTableModule,
  ],
  controllers: [CrawlProfileController],
  providers: [
    CrawlProfileService,
    CrmAuthService,
    CrmRequestRunnerService,
    CrmRequestSchedulerService,
  ],
  exports: [CrmAuthService],
})
export class CrawlProfileModule {}
