import {
  Controller,
  Post,
  Body,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Req,
  Headers,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { PluginDataService } from './plugin-data.service';
import { PluginSubmitDto } from './dto/plugin-submit.dto';
import { BrowserRequestDto } from './dto/browser-request.dto';
import type { Request } from 'express';

@Controller('plugin')
export class PluginDataController {
  private allowedMimeTypes: string[];
  private maxFileSize: number;

  constructor(
    private readonly pluginDataService: PluginDataService,
    private configService: ConfigService,
  ) {
    this.allowedMimeTypes = this.configService.get<string[]>(
      'upload.allowedMimeTypes',
    ) || ['image/jpeg', 'image/png', 'image/webp'];
    this.maxFileSize = this.configService.get<number>('upload.maxFileSize') || 10485760;
  }

  @Post('submit')
  @UseInterceptors(FileInterceptor('screenshot'))
  async submitData(
    @Body() dto: PluginSubmitDto,
    @UploadedFile() screenshot?: Express.Multer.File,
  ) {
    if (screenshot) {
      if (!this.allowedMimeTypes.includes(screenshot.mimetype)) {
        throw new BadRequestException(
          `Invalid file type. Allowed types: ${this.allowedMimeTypes.join(', ')}`,
        );
      }

      if (screenshot.size > this.maxFileSize) {
        throw new BadRequestException(
          `File size exceeds limit of ${this.maxFileSize / 1024 / 1024}MB`,
        );
      }
    }

    return this.pluginDataService.processPluginData(dto, screenshot);
  }

  @Post('requests')
  async handleBrowserRequest(@Req() req: Request, @Body() body: any) {
    const contentType = req.headers['content-type'] || '';

    console.log('📥 收到浏览器请求数据');
    console.log('Content-Type:', contentType);
    console.log('Body类型:', typeof body);
    console.log('Body前100字符:', typeof body === 'string' ? body.substring(0, 100) : JSON.stringify(body).substring(0, 100));

    // 如果是 HTML 或纯文本格式
    if (typeof body === 'string') {
      const htmlContent = body;
      const referer = req.headers['referer'] || req.headers['origin'] || 'unknown';
      console.log('✅ 识别为 HTML/Text 格式');
      return this.pluginDataService.processHtmlContent(htmlContent, referer);
    }

    // 如果是 JSON 格式
    console.log('✅ 识别为 JSON 格式');
    return this.pluginDataService.processBrowserRequest(body);
  }
}
