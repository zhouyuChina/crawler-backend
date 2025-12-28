import { IsString, IsOptional, IsUrl, IsObject } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class PluginSubmitDto {
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

  @IsObject()
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  })
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

  @IsOptional()
  @Type(() => Date)
  @Transform(({ value }) => {
    if (value) {
      return new Date(value);
    }
    return new Date();
  })
  capturedAt?: Date;
}
