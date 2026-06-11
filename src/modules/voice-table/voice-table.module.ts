import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { VoiceTableController } from './voice-table.controller';
import { VoiceTableService } from './voice-table.service';
import { VoiceIvrRecord } from './entities/voice-ivr-record.entity';
import { VoiceIvrExportFile } from './entities/voice-ivr-export-file.entity';
import { VoiceIvrSummary } from './entities/voice-ivr-summary.entity';
import { VoiceOpRecord } from './entities/voice-op-record.entity';
import { VoiceOpSummary } from './entities/voice-op-summary.entity';
import { VoiceDmOpRecord } from './entities/voice-dm-op-record.entity';
import { VoiceDmOpSummary } from './entities/voice-dm-op-summary.entity';
import { VoiceCrawlState } from './entities/voice-crawl-state.entity';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      VoiceIvrRecord,
      VoiceIvrExportFile,
      VoiceIvrSummary,
      VoiceOpRecord,
      VoiceOpSummary,
      VoiceDmOpRecord,
      VoiceDmOpSummary,
      VoiceCrawlState,
    ]),
    WebsocketModule,
  ],
  controllers: [VoiceTableController],
  providers: [VoiceTableService],
  exports: [VoiceTableService],
})
export class VoiceTableModule {}
