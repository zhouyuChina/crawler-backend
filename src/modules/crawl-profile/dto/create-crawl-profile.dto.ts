import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsObject,
  IsUrl,
} from 'class-validator';
import { CrawlContent } from '../crawl-profile.entity';

export class CreateCrawlProfileDto {
  @IsString()
  name: string;

  @IsString()
  baseUrl: string;

  @IsString()
  username: string;

  @IsString()
  password: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsArray()
  @IsOptional()
  contents?: CrawlContent[];

  @IsObject()
  @IsOptional()
  mids?: Record<string, number>;
}
