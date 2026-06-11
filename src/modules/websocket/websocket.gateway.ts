import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

const REQUEST_BODY_PREVIEW_LIMIT = 8 * 1024;
const ROOM_WEBPAGE_UPDATES = 'webpage-updates';
const ROOM_REQUEST_MONITOR = 'request-monitor';
const ROOM_CALL_RECORDS = 'call-records';
const ROOM_TABLE_CRAWL = 'table-crawl';

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
  private lastSocketBufferLogAt = 0;

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe:webpage')
  handleSubscribeWebpage(
    @ConnectedSocket() client: Socket,
    @MessageBody() _data: any,
  ) {
    if (!client?.id) return { success: false };
    this.logger.log(`Client ${client.id} subscribed to webpage updates`);
    client.join(ROOM_WEBPAGE_UPDATES);
    return { success: true };
  }

  @SubscribeMessage('unsubscribe:webpage')
  handleUnsubscribeWebpage(@ConnectedSocket() client: Socket) {
    if (!client?.id) return { success: false };
    this.logger.log(`Client ${client.id} unsubscribed from webpage updates`);
    client.leave(ROOM_WEBPAGE_UPDATES);
    return { success: true };
  }

  @SubscribeMessage('subscribe:request-monitor')
  handleSubscribeRequestMonitor(@ConnectedSocket() client: Socket) {
    if (!client?.id) return { success: false };
    this.logger.log(`Client ${client.id} subscribed to request monitor`);
    client.join(ROOM_REQUEST_MONITOR);
    client.emit('request:history', this.requestHistory);
    return { success: true };
  }

  @SubscribeMessage('unsubscribe:request-monitor')
  handleUnsubscribeRequestMonitor(@ConnectedSocket() client: Socket) {
    if (!client?.id) return { success: false };
    this.logger.log(`Client ${client.id} unsubscribed from request monitor`);
    client.leave(ROOM_REQUEST_MONITOR);
    return { success: true };
  }

  @SubscribeMessage('subscribe:call-records')
  handleSubscribeCallRecords(@ConnectedSocket() client: Socket) {
    if (!client?.id) return { success: false };
    this.logger.log(`Client ${client.id} subscribed to call records`);
    client.join(ROOM_CALL_RECORDS);
    return { success: true };
  }

  @SubscribeMessage('unsubscribe:call-records')
  handleUnsubscribeCallRecords(@ConnectedSocket() client: Socket) {
    if (!client?.id) return { success: false };
    this.logger.log(`Client ${client.id} unsubscribed from call records`);
    client.leave(ROOM_CALL_RECORDS);
    return { success: true };
  }

  @SubscribeMessage('subscribe:table-crawl')
  handleSubscribeTableCrawl(@ConnectedSocket() client: Socket) {
    if (!client?.id) return { success: false };
    this.logger.log(`Client ${client.id} subscribed to table crawl`);
    client.join(ROOM_TABLE_CRAWL);
    return { success: true };
  }

  @SubscribeMessage('unsubscribe:table-crawl')
  handleUnsubscribeTableCrawl(@ConnectedSocket() client: Socket) {
    if (!client?.id) return { success: false };
    this.logger.log(`Client ${client.id} unsubscribed from table crawl`);
    client.leave(ROOM_TABLE_CRAWL);
    return { success: true };
  }

  broadcastWebpageCreated(webpage: any) {
    this.server.to(ROOM_WEBPAGE_UPDATES).emit('webpage:created', webpage);
  }

  broadcastWebpageDeleted(webpageId: string) {
    this.server
      .to(ROOM_WEBPAGE_UPDATES)
      .emit('webpage:deleted', { id: webpageId });
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
    this.server.to(ROOM_REQUEST_MONITOR).emit('request:received', data);
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
    const safeData = this.sanitizeRequestEvent(data);
    this.upsertRequestHistory(safeData);
    this.server.to(ROOM_REQUEST_MONITOR).emit('request:processed', safeData);
    this.logSocketBufferStats('request-monitor');
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
    const safeEvent = this.sanitizeRequestEvent(event);
    const index = this.requestHistory.findIndex(
      (item) => item.id === safeEvent.id,
    );
    if (index >= 0) {
      this.requestHistory[index] = {
        ...this.requestHistory[index],
        ...safeEvent,
      };
    } else {
      this.requestHistory.unshift(safeEvent);
    }

    if (this.requestHistory.length > this.maxRequestHistory) {
      this.requestHistory.length = this.maxRequestHistory;
    }
  }

  private sanitizeRequestEvent<T extends { responseBody?: string }>(event: T): T {
    if (!event.responseBody) return event;
    if (event.responseBody.length <= REQUEST_BODY_PREVIEW_LIMIT) return event;
    return {
      ...event,
      responseBody: `${event.responseBody.slice(0, REQUEST_BODY_PREVIEW_LIMIT)}\n...[truncated ${event.responseBody.length - REQUEST_BODY_PREVIEW_LIMIT} chars]`,
    };
  }

  getMemoryDiagnostics() {
    let socketCount = 0;
    let socketBufferedPackets = 0;
    for (const socket of this.server.sockets.sockets.values()) {
      socketCount++;
      socketBufferedPackets += (socket.conn as any)?.writeBuffer?.length ?? 0;
    }
    return {
      requestHistorySize: this.requestHistory.length,
      socketCount,
      socketBufferedPackets,
    };
  }

  private logSocketBufferStats(reason: string) {
    const now = Date.now();
    if (now - this.lastSocketBufferLogAt < 30_000) return;
    this.lastSocketBufferLogAt = now;

    let sockets = 0;
    let bufferedPackets = 0;
    for (const socket of this.server.sockets.sockets.values()) {
      sockets++;
      bufferedPackets += ((socket.conn as any)?.writeBuffer?.length ?? 0);
    }
    if (sockets > 0 || bufferedPackets > 0) {
      this.logger.warn(
        `[mem-diagnose] ws ${reason}: sockets=${sockets} bufferedPackets=${bufferedPackets}`,
      );
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
    this.server.to(ROOM_CALL_RECORDS).emit('call-record:created', data);
    this.logger.log(`广播通话记录创建: ${data.recordType}`);
  }

  // 广播数据变更事件
  broadcastDataChanged(data: {
    recordType: string;
    oldData: any;
    newData: any;
    timestamp: string;
  }) {
    this.server.to(ROOM_CALL_RECORDS).emit('data:changed', data);
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
    this.server.to(ROOM_CALL_RECORDS).emit('call-record:updated', data);
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
    this.server.to(ROOM_CALL_RECORDS).emit('call-status:changed', data);
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
    this.server.to(ROOM_TABLE_CRAWL).emit('table-crawl:rows', data);
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
    this.server.to(ROOM_TABLE_CRAWL).emit('table-crawl:summary', data);
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
    this.server.to(ROOM_TABLE_CRAWL).emit('table-crawl:progress', data);
  }

  broadcastIvrExportChanged(data: {
    crmKey: string;
    mid: number;
    disposition: string;
    sourceDate: string;
    lineCount: number;
    previousLineCount: number | null;
    filePath: string;
    capturedAt: string;
  }) {
    this.server.to(ROOM_TABLE_CRAWL).emit('ivr-export:changed', data);
    this.logger.log(
      `广播 IVR 导出变化: ${data.crmKey} ${data.disposition} ${data.previousLineCount ?? '-'} -> ${data.lineCount}`,
    );
  }
}
