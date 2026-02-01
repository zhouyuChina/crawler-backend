import { Controller, Get, Param, Query } from '@nestjs/common';
import { CallRecordService } from './call-record.service';

@Controller('call-records')
export class CallRecordController {
  constructor(private readonly callRecordService: CallRecordService) {}

  @Get()
  async findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('recordType') recordType?: string,
  ) {
    return this.callRecordService.findAll({
      page: page || 1,
      limit: limit || 20,
      recordType,
    });
  }

  @Get('latest/:recordType')
  async findLatestByType(@Param('recordType') recordType: string) {
    const record = await this.callRecordService.findLatestByType(recordType);

    if (!record) {
      return {
        success: false,
        statusCode: 404,
        message: `暂无 ${recordType} 类型的数据`,
        recordType,
        timestamp: new Date().toISOString(),
        path: `/api/call-records/latest/${recordType}`,
      };
    }

    return record;
  }
}
