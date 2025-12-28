import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LocalStorageService } from './local-storage.service';

@Module({
  imports: [ConfigModule],
  providers: [LocalStorageService],
  exports: [LocalStorageService],
})
export class StorageModule {}
