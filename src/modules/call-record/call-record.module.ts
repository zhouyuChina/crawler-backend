import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallRecordController } from './call-record.controller';
import { CallRecordService } from './call-record.service';
import { CallRecord } from './entities/call-record.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CallRecord])],
  controllers: [CallRecordController],
  providers: [CallRecordService],
  exports: [CallRecordService],
})
export class CallRecordModule {}
