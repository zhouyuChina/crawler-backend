import { Injectable } from '@nestjs/common';
import { WebpageService } from '../webpage/webpage.service';
import { ScreenshotService } from '../screenshot/screenshot.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { CallRecordService } from '../call-record/call-record.service';
import { PluginSubmitDto } from './dto/plugin-submit.dto';
import { BrowserRequestDto } from './dto/browser-request.dto';
import { ProxyRequestDto } from './dto/proxy-request.dto';
import { v4 as uuidv4 } from 'uuid';
import * as http from 'http';
import * as https from 'https';
import * as crypto from 'crypto';

@Injectable()
export class PluginDataService {
  // 允许的关键词列表
  private readonly ALLOWED_KEYWORDS = [
    'get_curcall_in',
    'get_curcall_out',
    'get_peer_status',
    'cont_controler',
  ];

  // 需要变更检测的类型
  private readonly CHANGE_DETECTION_TYPES = ['get_peer_status', 'cont_controler'];

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

  async processBrowserRequest(dto: BrowserRequestDto) {
    const requestId = uuidv4();
    const timestamp = new Date().toISOString();

    // 1. 检查 URL 是否包含关键词
    const recordType = this.identifyRecordType(dto.url);

    // 如果不包含关键词，跳过处理
    if (!recordType) {
      console.log('⏭️ URL 不包含关键词，跳过处理:', dto.url);
      return {
        success: true,
        message: 'URL 不包含关键词，已跳过',
        skipped: true,
      };
    }

    console.log(`✅ 识别为 ${recordType} 类型请求`);

    // 2. 广播请求接收事件
    this.websocketGateway.broadcastRequestReceived({
      id: requestId,
      url: dto.url,
      method: dto.method,
      timestamp,
      status: 'processing',
    });

    try {
      // 3. 发起代理请求获取响应体
      const responseData = await this.makeHttpRequest({
        url: dto.url,
        method: dto.method || 'GET',
        headers: this.parseHeaders(dto.requestHeaders),
        body: dto.requestBody,
      });

      const responseBody = responseData.body;

      // 4. 判断是否需要变更检测
      if (this.needsChangeDetection(recordType)) {
        console.log(`🔍 ${recordType} 需要变更检测`);

        const { changed, hash } = await this.callRecordService.hasDataChanged(
          recordType,
          responseBody,
        );

        if (!changed) {
          console.log('⏭️ 数据未变化，跳过保存');

          this.websocketGateway.broadcastRequestProcessed({
            id: requestId,
            url: dto.url,
            method: dto.method,
            status: 'success',
            message: '数据未变化，已跳过',
            skipped: true,
          });

          return {
            success: true,
            message: '数据未变化，已跳过',
            skipped: true,
            reason: 'data_unchanged',
          };
        }

        console.log('✅ 数据已变化，准备保存');

        // 5. 解析响应体
        let parsedData = null;
        try {
          parsedData = JSON.parse(responseBody);
        } catch {
          // 不是 JSON 格式，保持为 null
        }

        // 6. 计算哈希值
        const hashValue = this.calculateHash(responseBody);

        // 7. 保存到数据库（变更检测类型使用 create）
        const callRecord = await this.callRecordService.create({
          recordType,
          url: dto.url,
          requestBody: dto.requestBody,
          responseBody,
          parsedData,
          dataHash: hashValue,
          statusCode: responseData.statusCode,
          metadata: {
            requestMethod: dto.method || 'GET',
            requestHeaders: dto.requestHeaders,
            responseHeaders: responseData.headers,
          },
        });

        console.log(`💾 通话记录已保存: ${callRecord.id}`);

        // 8. 广播 WebSocket 事件
        this.websocketGateway.broadcastCallRecordCreated({
          id: callRecord.id,
          recordType: callRecord.recordType,
          url: callRecord.url,
          parsedData: callRecord.parsedData,
          timestamp: callRecord.createdAt.toISOString(),
        });

        const previousRecords = await this.callRecordService.findPreviousByType(
          recordType,
          callRecord.id,
          1,
        );

        this.websocketGateway.broadcastDataChanged({
          recordType,
          oldData: previousRecords[0]?.parsedData || null,
          newData: callRecord.parsedData,
          timestamp: callRecord.createdAt.toISOString(),
        });

        // 9. 广播请求处理成功
        this.websocketGateway.broadcastRequestProcessed({
          id: requestId,
          url: dto.url,
          method: dto.method,
          status: 'success',
          message: '通话记录已保存',
          webpageId: callRecord.id,
          responseBody,
          statusCode: responseData.statusCode,
        });

        return {
          success: true,
          message: '通话记录已保存',
          recordId: callRecord.id,
          recordType: callRecord.recordType,
          changed: true,
        };
      } else {
        // get_curcall_in 和 get_curcall_out：使用 UPSERT
        console.log(`🔄 ${recordType} 使用 UPSERT 策略`);

        // 5. 解析响应体
        let parsedData = null;
        try {
          parsedData = JSON.parse(responseBody);
        } catch {
          // 不是 JSON 格式，保持为 null
        }

        // 6. 计算哈希值
        const hashValue = this.calculateHash(responseBody);

        // 7. 从 parsedData 中提取唯一键
        const uniqueKey = this.extractUniqueKey(recordType, parsedData);

        // 8. 使用 UPSERT 保存或更新记录
        const callRecord = await this.callRecordService.upsertByKey(
          recordType,
          uniqueKey,
          {
            recordType,
            url: dto.url,
            requestBody: dto.requestBody,
            responseBody,
            parsedData,
            dataHash: hashValue,
            statusCode: responseData.statusCode,
            metadata: {
              requestMethod: dto.method || 'GET',
              requestHeaders: dto.requestHeaders,
              responseHeaders: responseData.headers,
              uniqueKey,
            },
          },
        );

        console.log(`💾 通话记录已更新: ${callRecord.id}`);

        // 9. 广播更新事件
        this.websocketGateway.broadcastCallRecordUpdated({
          id: callRecord.id,
          recordType: callRecord.recordType,
          url: callRecord.url,
          parsedData: callRecord.parsedData,
          status: callRecord.status,
          timestamp: callRecord.lastUpdateTime.toISOString(),
        });

        // 10. 广播请求处理成功
        this.websocketGateway.broadcastRequestProcessed({
          id: requestId,
          url: dto.url,
          method: dto.method,
          status: 'success',
          message: '通话记录已更新',
          webpageId: callRecord.id,
          responseBody,
          statusCode: responseData.statusCode,
        });

        return {
          success: true,
          message: '通话记录已更新',
          recordId: callRecord.id,
          recordType: callRecord.recordType,
        };
      }
    } catch (error) {
      // 错误处理
      this.websocketGateway.broadcastRequestProcessed({
        id: requestId,
        url: dto.url,
        method: dto.method,
        status: 'error',
        error: error.message || '处理请求失败',
      });

      throw error;
    }
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
    const requestId = uuidv4();
    const timestamp = new Date().toISOString();

    // 广播请求接收事件
    this.websocketGateway.broadcastRequestReceived({
      id: requestId,
      url: dto.url,
      method: dto.method || 'GET',
      timestamp,
      status: 'processing',
    });

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

      // 广播请求处理成功
      this.websocketGateway.broadcastRequestProcessed({
        id: requestId,
        url: dto.url,
        method: dto.method || 'GET',
        status: 'success',
        message: `代理请求成功，状态码: ${responseData.statusCode}`,
        webpageId: webpage.id,
        responseBody: responseData.body, // 添加响应体
        statusCode: responseData.statusCode,
      });

      return {
        success: true,
        message: '代理请求成功',
        webpageId: webpage.id,
        statusCode: responseData.statusCode,
        responseBody: responseData.body,
        responseHeaders: responseData.headers,
      };
    } catch (error) {
      // 广播请求处理失败
      this.websocketGateway.broadcastRequestProcessed({
        id: requestId,
        url: dto.url,
        method: dto.method || 'GET',
        status: 'error',
        error: error.message || '代理请求失败',
      });

      throw error;
    }
  }

  /**
   * 识别 URL 中的记录类型
   */
  private identifyRecordType(url: string): string | null {
    for (const keyword of this.ALLOWED_KEYWORDS) {
      if (url.includes(keyword)) {
        return keyword;
      }
    }
    return null;
  }

  /**
   * 判断是否需要变更检测
   */
  private needsChangeDetection(recordType: string): boolean {
    return this.CHANGE_DETECTION_TYPES.includes(recordType);
  }

  /**
   * 提取唯一键（用于 UPSERT）
   */
  private extractUniqueKey(recordType: string, parsedData: any): string {
    if (!parsedData || !parsedData.calls || parsedData.calls.length === 0) {
      return `${recordType}-${Date.now()}`;
    }

    const firstCall = parsedData.calls[0];

    if (recordType === 'get_curcall_in') {
      // 呼入：使用 被叫號碼 + 回撥號碼
      return `${firstCall.calledNumber || ''}-${firstCall.callbackNumber || ''}`;
    } else if (recordType === 'get_curcall_out') {
      // 呼出：使用 主叫號碼 + 被叫號碼
      return `${firstCall.callerNumber || ''}-${firstCall.calledNumber || ''}`;
    }

    return `${recordType}-${Date.now()}`;
  }

  /**
   * 计算哈希值
   */
  private calculateHash(data: string): string {
    return crypto.createHash('md5').update(data).digest('hex');
  }

  /**
   * 解析请求头
   */
  private parseHeaders(headers: any): Record<string, string> {
    const result: Record<string, string> = {};

    if (Array.isArray(headers)) {
      headers.forEach((header: { name: string; value: string }) => {
        result[header.name] = header.value;
      });
    } else if (typeof headers === 'object') {
      Object.assign(result, headers);
    }

    return result;
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
