import {
  IsString,
  IsOptional,
  IsUrl,
  IsNumber,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BrowserRequestDto {
  @IsUrl()
  url: string;

  @IsString()
  @IsOptional()
  method?: string;

  @IsNumber()
  @IsOptional()
  statusCode?: number;

  @IsString()
  @IsOptional()
  timestamp?: string;

  @IsString()
  @IsOptional()
  dataType?: string;

  @IsString()
  @IsOptional()
  type?: string;

  @IsObject()
  @IsOptional()
  requestHeaders?: Record<string, string>;

  @IsObject()
  @IsOptional()
  responseHeaders?: Record<string, string>;

  @IsString()
  @IsOptional()
  requestBody?: string;

  @IsString()
  @IsOptional()
  responseBody?: string;

  @IsString()
  @IsOptional()
  tabId?: string;

  @IsString()
  @IsOptional()
  frameId?: string;

  @IsOptional()
  @Type(() => Date)
  receivedAt?: Date;
}
