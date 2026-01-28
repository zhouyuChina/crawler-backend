import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallRecordController } from './call-record.controller';
import { CallRecordService } from './call-record.service';
import { CallRecord } from './entities/call-record.entity';
import { HtmlParserService } from './parsers/html-parser.service';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CallRecord]),
    forwardRef(() => WebsocketModule),
  ],
  controllers: [CallRecordController],
  providers: [CallRecordService, HtmlParserService],
  exports: [CallRecordService],
})
export class CallRecordModule {}
