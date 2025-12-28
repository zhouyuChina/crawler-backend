import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Screenshot } from './entities/screenshot.entity';
import { LocalStorageService } from '../storage/local-storage.service';

@Injectable()
export class ScreenshotService {
  constructor(
    @InjectRepository(Screenshot)
    private screenshotRepository: Repository<Screenshot>,
    private localStorageService: LocalStorageService,
  ) {}

  async saveScreenshot(
    file: Express.Multer.File,
    webpageId: string,
  ): Promise<Screenshot> {
    const storageResult = await this.localStorageService.saveFile(
      file,
      'screenshots',
    );

    const screenshot = this.screenshotRepository.create({
      filename: storageResult.filename,
      filepath: storageResult.filepath,
      mimetype: storageResult.mimetype,
      size: storageResult.size,
      publicUrl: storageResult.publicUrl,
      storageType: 'local',
      webpageId,
    });

    return await this.screenshotRepository.save(screenshot);
  }

  async deleteScreenshot(id: string): Promise<void> {
    const screenshot = await this.screenshotRepository.findOne({
      where: { id },
    });

    if (screenshot) {
      await this.localStorageService.deleteFile(screenshot.filepath);
      await this.screenshotRepository.remove(screenshot);
    }
  }
}
