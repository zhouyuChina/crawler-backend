import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import {
  StorageInterface,
  StorageResult,
} from './interfaces/storage.interface';

@Injectable()
export class LocalStorageService implements StorageInterface {
  private uploadPath: string;

  constructor(private configService: ConfigService) {
    this.uploadPath = this.configService.get<string>('upload.dest') || './uploads';
  }

  async saveFile(
    file: Express.Multer.File,
    folder = 'screenshots',
  ): Promise<StorageResult> {
    const ext = path.extname(file.originalname);
    const filename = `${uuidv4()}${ext}`;
    const folderPath = path.join(this.uploadPath, folder);
    const filepath = path.join(folderPath, filename);

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    fs.writeFileSync(filepath, file.buffer);

    return {
      filename,
      filepath: path.join(folder, filename),
      publicUrl: `/api/files/${folder}/${filename}`,
      size: file.size,
      mimetype: file.mimetype,
    };
  }

  async deleteFile(filepath: string): Promise<boolean> {
    try {
      const fullPath = path.join(this.uploadPath, filepath);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  getFileUrl(filepath: string): string {
    return `/api/files/${filepath}`;
  }
}
