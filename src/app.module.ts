import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { WebpageModule } from './modules/webpage/webpage.module';
import { ScreenshotModule } from './modules/screenshot/screenshot.module';
import { PluginDataModule } from './modules/plugin-data/plugin-data.module';
import { WebsocketModule } from './modules/websocket/websocket.module';
import { StatisticsModule } from './modules/statistics/statistics.module';
import { StorageModule } from './modules/storage/storage.module';
import { MonitorModule } from './modules/monitor/monitor.module';
import { CallRecordModule } from './modules/call-record/call-record.module';
import { LoggerMiddleware } from './common/middleware/logger.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ScheduleModule.forRoot(), // 启用定时任务
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('database.host'),
        port: configService.get('database.port'),
        username: configService.get('database.username'),
        password: configService.get('database.password'),
        database: configService.get('database.database'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: configService.get('database.synchronize'),
        logging: configService.get('database.logging'),
      }),
      inject: [ConfigService],
    }),
    WebpageModule,
    ScreenshotModule,
    PluginDataModule,
    WebsocketModule,
    StatisticsModule,
    StorageModule,
    MonitorModule,
    CallRecordModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
