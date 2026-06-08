import { IsArray, IsOptional, IsString } from 'class-validator';

export class TableCrawlHeaderDto {
  @IsString()
  name: string;

  @IsString()
  value: string;
}

export class TableCrawlDto {
  @IsString()
  url: string;

  @IsOptional()
  @IsString()
  profileId?: string;

  @IsOptional()
  @IsString()
  method?: string;

  /** 浏览器原始 headers(数组形式或对象形式) */
  @IsOptional()
  headers?: Array<{ name: string; value: string }> | Record<string, string>;
}
