import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryWebpageDto {
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page?: number = 1;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  limit?: number = 10;

  @IsString()
  @IsOptional()
  domain?: string;

  @IsString()
  @IsOptional()
  keyword?: string;

  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  endDate?: string;
}
