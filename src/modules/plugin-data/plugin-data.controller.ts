import {
  Controller,
  Post,
  Body,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { PluginDataService } from './plugin-data.service';
import { PluginSubmitDto } from './dto/plugin-submit.dto';

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
}
