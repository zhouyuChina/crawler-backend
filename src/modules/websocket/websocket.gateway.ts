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
    origin: '*',
  },
  namespace: '/ws',
})
export class WebsocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private logger = new Logger('WebsocketGateway');

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
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
    this.server.to('webpage-updates').emit('webpage:deleted', { id: webpageId });
    this.server.emit('webpage:deleted', { id: webpageId });
  }

  broadcastStatisticsUpdate(stats: any) {
    this.server.emit('statistics:updated', stats);
  }
}
