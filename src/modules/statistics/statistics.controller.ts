import { Controller, Get, Query } from '@nestjs/common';
import { StatisticsService } from './statistics.service';

@Controller('statistics')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get('overview')
  getOverview() {
    return this.statisticsService.getOverview();
  }

  @Get('domain-analysis')
  getDomainAnalysis() {
    return this.statisticsService.getDomainAnalysis();
  }

  @Get('time-series')
  getTimeSeries(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.statisticsService.getTimeSeries(startDate, endDate);
  }
}
