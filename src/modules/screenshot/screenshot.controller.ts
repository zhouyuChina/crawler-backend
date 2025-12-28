import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';

@Controller('files')
export class ScreenshotController {
  private uploadPath: string;

  constructor(private configService: ConfigService) {
    this.uploadPath = this.configService.get<string>('upload.dest') || './uploads';
  }

  @Get(':folder/:filename')
  async getFile(
    @Param('folder') folder: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    const filepath = path.join(this.uploadPath, folder, filename);

    if (!fs.existsSync(filepath)) {
      throw new NotFoundException('File not found');
    }

    res.sendFile(filepath);
  }
}
