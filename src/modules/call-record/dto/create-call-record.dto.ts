import { IsString, IsOptional, IsNumber, IsObject } from 'class-validator';

export class CreateCallRecordDto {
  @IsString()
  recordType: string;

  @IsString()
  url: string;

  @IsOptional()
  @IsString()
  requestBody?: string;

  @IsOptional()
  @IsString()
  responseBody?: string;

  @IsOptional()
  @IsObject()
  parsedData?: any;

  @IsOptional()
  @IsString()
  dataHash?: string;

  @IsOptional()
  @IsNumber()
  statusCode?: number;

  @IsOptional()
  @IsObject()
  metadata?: any;
}
