import { IsString, IsOptional, IsUrl, IsObject, IsDate } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateWebpageDto {
  @IsUrl()
  url: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  content?: string;

  @IsString()
  @IsOptional()
  htmlContent?: string;

  @IsString()
  @IsOptional()
  domain?: string;

  @IsObject()
  @IsOptional()
  metadata?: {
    description?: string;
    keywords?: string[];
    author?: string;
    ogImage?: string;
  };

  @IsString()
  @IsOptional()
  sourcePluginId?: string;

  @IsString()
  @IsOptional()
  browserType?: string;

  @IsDate()
  @Type(() => Date)
  @IsOptional()
  capturedAt?: Date;
}
