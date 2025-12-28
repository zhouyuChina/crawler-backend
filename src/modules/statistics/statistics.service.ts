import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Webpage } from '../webpage/entities/webpage.entity';
import { Screenshot } from '../screenshot/entities/screenshot.entity';

@Injectable()
export class StatisticsService {
  constructor(
    @InjectRepository(Webpage)
    private webpageRepository: Repository<Webpage>,
    @InjectRepository(Screenshot)
    private screenshotRepository: Repository<Screenshot>,
  ) {}

  async getOverview() {
    const [totalWebpages, totalScreenshots] = await Promise.all([
      this.webpageRepository.count(),
      this.screenshotRepository.count(),
    ]);

    const topDomains = await this.webpageRepository
      .createQueryBuilder('webpage')
      .select('webpage.domain', 'domain')
      .addSelect('COUNT(*)', 'count')
      .where('webpage.domain IS NOT NULL')
      .groupBy('webpage.domain')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany();

    const recentActivity = await this.webpageRepository
      .createQueryBuilder('webpage')
      .select('DATE(webpage.createdAt)', 'date')
      .addSelect('COUNT(*)', 'count')
      .where("webpage.createdAt >= NOW() - INTERVAL '7 days'")
      .groupBy('DATE(webpage.createdAt)')
      .orderBy('date', 'ASC')
      .getRawMany();

    return {
      totalWebpages,
      totalScreenshots,
      topDomains: topDomains.map((d) => ({
        domain: d.domain,
        count: parseInt(d.count),
      })),
      recentActivity: recentActivity.map((a) => ({
        date: a.date,
        count: parseInt(a.count),
      })),
    };
  }

  async getDomainAnalysis() {
    const domains = await this.webpageRepository
      .createQueryBuilder('webpage')
      .select('webpage.domain', 'domain')
      .addSelect('COUNT(*)', 'count')
      .where('webpage.domain IS NOT NULL')
      .groupBy('webpage.domain')
      .orderBy('count', 'DESC')
      .getRawMany();

    const total = domains.reduce((sum, d) => sum + parseInt(d.count), 0);

    return {
      domains: domains.map((d) => ({
        domain: d.domain,
        count: parseInt(d.count),
        percentage: total > 0 ? ((parseInt(d.count) / total) * 100).toFixed(2) : '0',
      })),
    };
  }

  async getTimeSeries(startDate?: string, endDate?: string) {
    const query = this.webpageRepository
      .createQueryBuilder('webpage')
      .select('DATE(webpage.createdAt)', 'date')
      .addSelect('COUNT(*)', 'count')
      .groupBy('DATE(webpage.createdAt)')
      .orderBy('date', 'ASC');

    if (startDate && endDate) {
      query.where('webpage.createdAt BETWEEN :startDate AND :endDate', {
        startDate: new Date(startDate),
        endDate: new Date(endDate),
      });
    }

    const results = await query.getRawMany();

    return results.map((r) => ({
      date: r.date,
      count: parseInt(r.count),
    }));
  }
}
