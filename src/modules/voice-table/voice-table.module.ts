import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { VoiceTableController } from './voice-table.controller';
import { VoiceTableService } from './voice-table.service';
import { VoiceIvrRecord } from './entities/voice-ivr-record.entity';
import { VoiceIvrSummary } from './entities/voice-ivr-summary.entity';
import { VoiceOpRecord } from './entities/voice-op-record.entity';
import { VoiceOpSummary } from './entities/voice-op-summary.entity';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      VoiceIvrRecord,
      VoiceIvrSummary,
      VoiceOpRecord,
      VoiceOpSummary,
    ]),
    WebsocketModule,
  ],
  controllers: [VoiceTableController],
  providers: [VoiceTableService],
  exports: [VoiceTableService],
})
export class VoiceTableModule {}
