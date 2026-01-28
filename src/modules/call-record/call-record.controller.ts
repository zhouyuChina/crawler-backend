import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { CallRecordService } from './call-record.service';
import { QueryCallRecordDto } from './dto/query-call-record.dto';

@Controller('call-records')
export class CallRecordController {
  constructor(private readonly callRecordService: CallRecordService) {}

  @Get()
  async findAll(@Query() dto: QueryCallRecordDto) {
    return await this.callRecordService.findAll(dto);
  }

  @Get('statistics')
  async getStatistics() {
    return await this.callRecordService.getStatistics();
  }

  @Get('latest/:recordType')
  async findLatestByType(@Param('recordType') recordType: string) {
    const record =
      await this.callRecordService.findLatestByType(recordType);

    if (!record) {
      throw new NotFoundException(
        `No records found for type: ${recordType}`,
      );
    }

    return record;
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const record = await this.callRecordService.findOne(id);

    if (!record) {
      throw new NotFoundException(`Record with ID ${id} not found`);
    }

    return record;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.callRecordService.remove(id);
    return { message: '通话记录已删除' };
  }
}
