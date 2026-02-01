import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CallRecordController } from './call-record.controller';
import { CallRecordService } from './call-record.service';
import { Webpage } from '../webpage/entities/webpage.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Webpage])],
  controllers: [CallRecordController],
  providers: [CallRecordService],
  exports: [CallRecordService],
})
export class CallRecordModule {}
