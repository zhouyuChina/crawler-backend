import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false, // 禁用默认的 body parser
  });

  // 配置静态文件服务
  app.useStaticAssets(join(__dirname, '..', 'public'));

  app.setGlobalPrefix('api');

  // 手动配置 body parser，支持多种格式
  const express = require('express');
  app.use(
    express.json({ limit: '10mb' }), // JSON 格式
    express.urlencoded({ extended: true, limit: '10mb' }), // Form 格式
    express.text({ type: 'text/*', limit: '10mb' }), // Text 格式（包括 text/html, text/plain）
    express.raw({ type: 'application/octet-stream', limit: '10mb' }), // 二进制格式
  );

  app.enableCors({
    origin: (origin, callback) => {
      // 允许所有来源（包括内网穿透域名）
      // 当 credentials: true 时，不能使用 '*'，需要动态返回请求的 origin
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cookie', 'X-Requested-With'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false, // 改为 false，允许额外字段
      skipMissingProperties: true, // 跳过缺失的属性
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  app.useGlobalInterceptors(new TransformInterceptor());

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`API endpoints: http://localhost:${port}/api`);
  console.log(`WebSocket: ws://localhost:${port}/ws`);
  console.log(`Monitor page: http://localhost:${port}/api/monitor`);
}
bootstrap();
