export interface StorageInterface {
  saveFile(file: Express.Multer.File, folder?: string): Promise<StorageResult>;
  deleteFile(filepath: string): Promise<boolean>;
  getFileUrl(filepath: string): string;
}

export interface StorageResult {
  filename: string;
  filepath: string;
  publicUrl: string;
  size: number;
  mimetype: string;
}
