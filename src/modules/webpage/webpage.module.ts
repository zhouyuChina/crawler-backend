import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Webpage } from './entities/webpage.entity';
import { WebpageService } from './webpage.service';
import { WebpageController } from './webpage.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Webpage])],
  controllers: [WebpageController],
  providers: [WebpageService],
  exports: [WebpageService],
})
export class WebpageModule {}
