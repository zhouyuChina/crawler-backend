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
      return {
        success: false,
        statusCode: 404,
        message: `No records found for type: ${recordType}`,
        timestamp: new Date().toISOString(),
        path: `/api/call-records/latest/${recordType}`,
      };
    }

    return record;
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const record = await this.callRecordService.findOne(id);

    if (!record) {
      return {
        success: false,
        statusCode: 404,
        message: `Record with ID ${id} not found`,
        timestamp: new Date().toISOString(),
        path: `/api/call-records/${id}`,
      };
    }

    return record;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.callRecordService.remove(id);
    return { message: '通话记录已删除' };
  }
}
