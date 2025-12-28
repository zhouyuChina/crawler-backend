import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Webpage } from '../webpage/entities/webpage.entity';
import { Screenshot } from '../screenshot/entities/screenshot.entity';
import { StatisticsService } from './statistics.service';
import { StatisticsController } from './statistics.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Webpage, Screenshot])],
  controllers: [StatisticsController],
  providers: [StatisticsService],
  exports: [StatisticsService],
})
export class StatisticsModule {}
