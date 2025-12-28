import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WebpageService } from './webpage.service';
import { QueryWebpageDto } from './dto/query-webpage.dto';

@Controller('webpage')
export class WebpageController {
  constructor(private readonly webpageService: WebpageService) {}

  @Get()
  findAll(@Query() query: QueryWebpageDto) {
    return this.webpageService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.webpageService.findOne(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.webpageService.remove(id);
  }
}
