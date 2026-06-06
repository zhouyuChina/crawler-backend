import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: true, // 允许所有来源（动态返回请求的 origin）
    credentials: true,
    methods: ['GET', 'POST'],
  },
  namespace: '/ws',
  transports: ['websocket', 'polling'], // 支持 websocket 和轮询两种方式
})
export class WebsocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private logger = new Logger('WebsocketGateway');
  private readonly requestHistory: Array<{
    id: string;
    url: string;
    method?: string;
    timestamp?: string;
    status: 'processing' | 'success' | 'error';
    message?: string;
    error?: string;
    skipped?: boolean;
    webpageId?: string;
    responseBody?: string;
    statusCode?: number;
  }> = [];
  private readonly maxRequestHistory = 100;

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    client.emit('request:history', this.requestHistory);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe:webpage')
  handleSubscribeWebpage(client: Socket, @MessageBody() data: any) {
    this.logger.log(`Client ${client.id} subscribed to webpage updates`);
    client.join('webpage-updates');
    return { success: true };
  }

  @SubscribeMessage('unsubscribe:webpage')
  handleUnsubscribeWebpage(client: Socket) {
    this.logger.log(`Client ${client.id} unsubscribed from webpage updates`);
    client.leave('webpage-updates');
    return { success: true };
  }

  broadcastWebpageCreated(webpage: any) {
    this.server.to('webpage-updates').emit('webpage:created', webpage);
    this.server.emit('webpage:created', webpage);
  }

  broadcastWebpageDeleted(webpageId: string) {
    this.server
      .to('webpage-updates')
      .emit('webpage:deleted', { id: webpageId });
    this.server.emit('webpage:deleted', { id: webpageId });
  }

  broadcastStatisticsUpdate(stats: any) {
    this.server.emit('statistics:updated', stats);
  }

  // 广播请求接收事件
  broadcastRequestReceived(data: {
    id: string;
    url: string;
    method?: string;
    timestamp: string;
    status: 'processing';
  }) {
    this.upsertRequestHistory(data);
    this.server.emit('request:received', data);
    this.logger.log(`广播请求接收: ${data.method} ${data.url}`);
  }

  // 广播请求处理完成事件
  broadcastRequestProcessed(data: {
    id: string;
    url: string;
    method?: string;
    status: 'success' | 'error';
    message?: string;
    error?: string;
    skipped?: boolean;
    webpageId?: string;
    responseBody?: string;
    statusCode?: number;
  }) {
    this.upsertRequestHistory(data);
    this.server.emit('request:processed', data);
    this.logger.log(`广播请求处理完成: ${data.status} - ${data.url}`);
  }

  private upsertRequestHistory(event: {
    id: string;
    url: string;
    method?: string;
    timestamp?: string;
    status: 'processing' | 'success' | 'error';
    message?: string;
    error?: string;
    skipped?: boolean;
    webpageId?: string;
    responseBody?: string;
    statusCode?: number;
  }) {
    const index = this.requestHistory.findIndex((item) => item.id === event.id);
    if (index >= 0) {
      this.requestHistory[index] = {
        ...this.requestHistory[index],
        ...event,
      };
    } else {
      this.requestHistory.unshift(event);
    }

    if (this.requestHistory.length > this.maxRequestHistory) {
      this.requestHistory.length = this.maxRequestHistory;
    }
  }

  // 广播通话记录创建事件
  broadcastCallRecordCreated(data: {
    id: string;
    recordType: string;
    url: string;
    content?: string;
    parsedData?: any;
    statusCode?: number;
    timestamp: string;
  }) {
    this.server.emit('call-record:created', data);
    this.logger.log(`广播通话记录创建: ${data.recordType}`);
  }

  // 广播数据变更事件
  broadcastDataChanged(data: {
    recordType: string;
    oldData: any;
    newData: any;
    timestamp: string;
  }) {
    this.server.emit('data:changed', data);
    this.logger.log(`广播数据变更: ${data.recordType}`);
  }

  // 广播通话记录更新事件（用于持续更新的通话）
  broadcastCallRecordUpdated(data: {
    id: string;
    recordType: string;
    url: string;
    parsedData: any;
    status: string;
    timestamp: string;
  }) {
    this.server.emit('call-record:updated', data);
    this.logger.log(`广播通话记录更新: ${data.recordType} - ${data.status}`);
  }

  // 广播通话状态变更事件
  broadcastCallStatusChanged(data: {
    id: string;
    recordType: string;
    status: string;
    parsedData: any;
    timestamp: string;
  }) {
    this.server.emit('call-status:changed', data);
    this.logger.log(`广播通话状态变更: ${data.recordType} → ${data.status}`);
  }

  // 广播表格抓取每页新增的行
  broadcastVoiceTableRows(data: {
    module: string;
    mid: number;
    page: number;
    rows: any[];
    taskId: string;
    timestamp: string;
  }) {
    this.server.emit('table-crawl:rows', data);
    this.logger.log(
      `广播表格新增行: ${data.module} mid=${data.mid} page=${data.page} +${data.rows.length}`,
    );
  }

  // 广播表格抓取汇总
  broadcastVoiceTableSummary(data: {
    module: string;
    mid: number;
    summary: any;
    totalPages: number;
    pagesToFetch: number;
    capturedAt: string;
    taskId: string;
  }) {
    this.server.emit('table-crawl:summary', data);
    this.logger.log(
      `广播表格汇总: ${data.module} mid=${data.mid} pages=${data.pagesToFetch}/${data.totalPages}`,
    );
  }

  // 广播表格抓取进度
  broadcastVoiceTableProgress(data: {
    module: string;
    mid: number;
    taskId: string;
    page: number;
    pagesToFetch: number;
    status: 'running' | 'completed' | 'failed' | 'throttled';
    error?: string;
  }) {
    this.server.emit('table-crawl:progress', data);
  }
}
