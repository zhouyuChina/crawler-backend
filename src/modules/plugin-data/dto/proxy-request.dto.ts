import { IsString, IsOptional, IsUrl, IsObject } from 'class-validator';

export class ProxyRequestDto {
  @IsUrl()
  url: string;

  @IsString()
  @IsOptional()
  method?: string; // GET, POST, PUT, DELETE 等

  @IsObject()
  @IsOptional()
  headers?: Record<string, string>; // 自定义请求头

  @IsString()
  @IsOptional()
  body?: string; // 请求体（JSON 字符串或其他格式）

  @IsString()
  @IsOptional()
  contentType?: string; // 请求的 Content-Type

  /** 来源标识，如 browser-extension-proxy / crawl-profile-scheduler */
  @IsString()
  @IsOptional()
  sourcePluginId?: string;
}
