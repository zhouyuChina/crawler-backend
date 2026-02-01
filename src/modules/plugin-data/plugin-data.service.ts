import { Injectable } from '@nestjs/common';
import { WebpageService } from '../webpage/webpage.service';
import { ScreenshotService } from '../screenshot/screenshot.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { CallRecordService } from '../call-record/call-record.service';
import { PluginSubmitDto } from './dto/plugin-submit.dto';
import { ProxyRequestDto } from './dto/proxy-request.dto';
import * as http from 'http';
import * as https from 'https';

@Injectable()
export class PluginDataService {
  constructor(
    private readonly webpageService: WebpageService,
    private readonly screenshotService: ScreenshotService,
    private readonly websocketGateway: WebsocketGateway,
    private readonly callRecordService: CallRecordService,
  ) {}

  async processPluginData(
    dto: PluginSubmitDto,
    screenshot?: Express.Multer.File,
  ) {
    const url = new URL(dto.url);
    const domain = url.hostname;

    const webpage = await this.webpageService.create({
      url: dto.url,
      title: dto.title,
      content: dto.content,
      htmlContent: dto.htmlContent,
      domain,
      metadata: dto.metadata,
      sourcePluginId: dto.sourcePluginId,
      browserType: dto.browserType,
      capturedAt: dto.capturedAt || new Date(),
    });

    if (screenshot) {
      await this.screenshotService.saveScreenshot(screenshot, webpage.id);
    }

    this.websocketGateway.broadcastWebpageCreated(webpage);

    return {
      webpageId: webpage.id,
      message: 'Data received successfully',
    };
  }

  async processHtmlContent(htmlContent: string, referer: string) {
    // 从 HTML 中提取 URL 和标题
    const urlMatch =
      htmlContent.match(
        /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:url["']/i,
      ) || htmlContent.match(/https?:\/\/[^\s<>"]+/i);
    const url = urlMatch ? urlMatch[1] || urlMatch[0] : referer;

    const titleMatch = htmlContent.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '未命名页面';

    // 提取纯文本内容
    const textContent = htmlContent
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 5000); // 限制长度

    let domain = 'unknown';
    try {
      domain = new URL(url).hostname;
    } catch {
      // URL 解析失败，使用默认值
    }

    const webpage = await this.webpageService.create({
      url,
      title,
      content: textContent,
      htmlContent,
      domain,
      metadata: {
        description: textContent.substring(0, 200),
        referer,
      } as Record<string, unknown>,
      sourcePluginId: 'browser-extension-html',
      browserType: 'chrome',
      capturedAt: new Date(),
    });

    this.websocketGateway.broadcastWebpageCreated(webpage);

    return {
      success: true,
      message: '请求已接收',
      webpageId: webpage.id,
    };
  }

  /**
   * 代理请求：服务器代表插件发起 HTTP 请求，获取响应体
   */
  async proxyRequest(dto: ProxyRequestDto) {
    try {
      // 发起 HTTP/HTTPS 请求
      const responseData = await this.makeHttpRequest(dto);

      const url = new URL(dto.url);
      const domain = url.hostname;

      // 判断响应体类型
      let content = '';
      let htmlContent = '';

      if (responseData.body) {
        const bodyStr = responseData.body.trim();

        // 判断是否为 HTML
        const isHtml =
          /^\s*<!DOCTYPE\s+html/i.test(bodyStr) ||
          /^\s*<html[\s>]/i.test(bodyStr) ||
          /<html[\s>]/i.test(bodyStr);

        if (isHtml) {
          htmlContent = bodyStr;
        } else {
          content = bodyStr;
        }
      }

      // 存储到数据库
      const webpage = await this.webpageService.create({
        url: dto.url,
        title: `${dto.method || 'GET'} - ${dto.url}`,
        content,
        htmlContent,
        domain,
        metadata: {
          description: `Proxied ${dto.method || 'GET'} request to ${dto.url}`,
          requestMethod: dto.method || 'GET',
          statusCode: responseData.statusCode,
          requestHeaders: dto.headers,
          responseHeaders: responseData.headers,
          proxied: true,
        } as Record<string, unknown>,
        sourcePluginId: 'browser-extension-proxy',
        browserType: 'chrome',
        capturedAt: new Date(),
      });

      this.websocketGateway.broadcastWebpageCreated(webpage);

      // 判断是否是 call-record 类型，如果是则触发专门的事件
      const recordType = this.identifyRecordType(dto.url);
      if (recordType) {
        // 记录通话更新时间（用于判断通话是否结束）
        this.callRecordService.recordCallUpdate(recordType, webpage.id);

        this.websocketGateway.broadcastCallRecordCreated({
          id: webpage.id,
          recordType,
          url: webpage.url,
          content: webpage.content || webpage.htmlContent,
          statusCode: responseData.statusCode,
          timestamp: webpage.createdAt.toISOString(),
        });
      }

      return {
        success: true,
        message: '代理请求成功',
        webpageId: webpage.id,
        statusCode: responseData.statusCode,
        responseBody: responseData.body,
        responseHeaders: responseData.headers,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * 识别 URL 中的记录类型
   */
  private identifyRecordType(url: string): string | null {
    const keywords = ['get_peer_status', 'cont_controler', 'get_curcall_in', 'get_curcall_out'];

    for (const keyword of keywords) {
      if (url.includes(keyword)) {
        return keyword;
      }
    }

    return null;
  }

  /**
   * 发起 HTTP/HTTPS 请求
   */
  private makeHttpRequest(
    dto: ProxyRequestDto,
  ): Promise<{ statusCode: number; headers: any; body: string }> {
    return new Promise((resolve, reject) => {
      const url = new URL(dto.url);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: dto.method || 'GET',
        headers: dto.headers || {},
        timeout: 30000, // 30 秒超时
      };

      // 设置 Content-Type
      if (dto.contentType && dto.body) {
        options.headers['Content-Type'] = dto.contentType;
      }

      const req = client.request(options, (res) => {
        let body = '';

        res.on('data', (chunk) => {
          body += chunk;
        });

        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body,
          });
        });
      });

      req.on('error', (error) => {
        reject(new Error(`请求失败: ${error.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('请求超时'));
      });

      // 如果有请求体，写入
      if (dto.body) {
        req.write(dto.body);
      }

      req.end();
    });
  }
}
