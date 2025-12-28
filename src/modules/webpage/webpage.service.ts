import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, Between } from 'typeorm';
import { Webpage } from './entities/webpage.entity';
import { CreateWebpageDto } from './dto/create-webpage.dto';
import { QueryWebpageDto } from './dto/query-webpage.dto';

@Injectable()
export class WebpageService {
  constructor(
    @InjectRepository(Webpage)
    private webpageRepository: Repository<Webpage>,
  ) {}

  async create(createWebpageDto: CreateWebpageDto): Promise<Webpage> {
    const webpage = this.webpageRepository.create(createWebpageDto);
    return await this.webpageRepository.save(webpage);
  }

  async findAll(query: QueryWebpageDto) {
    const { page = 1, limit = 10, domain, keyword, startDate, endDate } = query;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (domain) {
      where.domain = domain;
    }

    if (keyword) {
      where.title = Like(`%${keyword}%`);
    }

    if (startDate && endDate) {
      where.createdAt = Between(new Date(startDate), new Date(endDate));
    }

    const [data, total] = await this.webpageRepository.findAndCount({
      where,
      relations: ['screenshots'],
      skip,
      take: limit,
      order: { createdAt: 'DESC' },
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string): Promise<Webpage> {
    const webpage = await this.webpageRepository.findOne({
      where: { id },
      relations: ['screenshots'],
    });

    if (!webpage) {
      throw new NotFoundException(`Webpage with ID ${id} not found`);
    }

    return webpage;
  }

  async remove(id: string): Promise<void> {
    const webpage = await this.findOne(id);
    await this.webpageRepository.remove(webpage);
  }
}
