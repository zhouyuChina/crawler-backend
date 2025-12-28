import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('user-agent') || '';
    const startTime = Date.now();

    // 记录请求信息
    this.logger.log(
      `→ ${method} ${originalUrl} - ${ip} - ${userAgent}`,
    );

    // 监听响应完成
    res.on('finish', () => {
      const { statusCode } = res;
      const duration = Date.now() - startTime;
      const contentLength = res.get('content-length') || 0;

      this.logger.log(
        `← ${method} ${originalUrl} ${statusCode} ${contentLength}b - ${duration}ms`,
      );
    });

    next();
  }
}
