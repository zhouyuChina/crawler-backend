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

  // 请求去重缓存：URL -> { timestamp, result }
  private readonly recentRequests = new Map<
    string,
    { timestamp: number; result: any }
  >();

  // 去重时间窗口（毫秒）
  private readonly DEDUP_WINDOW_MS = 2000;

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

    // 1.5 去重检查：如果同一 URL 在短时间内已成功处理，跳过
    const dedupResult = this.checkAndCacheRequest(dto.url);
    if (dedupResult) {
      console.log('⏭️ [去重] 请求已在近期处理过，跳过:', dto.url);
      return dedupResult;
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

        // 🔥 新增：如果响应码不是 200，不保存到数据库，只推送错误信息
        if (responseData.statusCode !== 200) {
          console.log(`⚠️ 响应码 ${responseData.statusCode}，跳过保存到数据库`);

          this.websocketGateway.broadcastRequestProcessed({
            id: requestId,
            url: dto.url,
            method: dto.method,
            status: 'error',
            message: `目标网站返回错误: ${responseData.statusCode}`,
            statusCode: responseData.statusCode,
            responseBody,
          });

          return {
            success: false,
            message: `目标网站返回错误: ${responseData.statusCode}`,
            statusCode: responseData.statusCode,
          };
        }

        const { changed } = await this.callRecordService.hasDataChanged(
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

        const result = {
          success: true,
          message: '通话记录已保存',
          recordId: callRecord.id,
          recordType: callRecord.recordType,
          changed: true,
        };
        this.cacheSuccessfulRequest(dto.url, result);
        return result;
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

        const result = {
          success: true,
          message: '通话记录已更新',
          recordId: callRecord.id,
          recordType: callRecord.recordType,
        };
        this.cacheSuccessfulRequest(dto.url, result);
        return result;
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
   * 检查请求是否在去重窗口内，如果是则返回缓存结果
   * 如果不是，则缓存当前请求（稍后由 cacheSuccessfulRequest 更新结果）
   */
  private checkAndCacheRequest(url: string): any | null {
    const now = Date.now();

    // 清理过期的缓存
    this.cleanExpiredCache();

    // 提取 URL 的基础部分（去掉时间戳参数）
    const baseUrl = this.normalizeUrl(url);

    const cached = this.recentRequests.get(baseUrl);
    if (cached && now - cached.timestamp < this.DEDUP_WINDOW_MS) {
      // 在去重窗口内，返回缓存的结果
      return {
        ...cached.result,
        deduplicated: true,
        message: '请求已去重（近期已处理）',
      };
    }

    return null;
  }

  /**
   * 缓存成功的请求结果
   */
  private cacheSuccessfulRequest(url: string, result: any): void {
    const baseUrl = this.normalizeUrl(url);
    this.recentRequests.set(baseUrl, {
      timestamp: Date.now(),
      result,
    });
  }

  /**
   * 标准化 URL（去掉时间戳等动态参数）
   */
  private normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      // 移除常见的时间戳参数
      urlObj.searchParams.delete('date');
      urlObj.searchParams.delete('timestamp');
      urlObj.searchParams.delete('t');
      urlObj.searchParams.delete('_');
      return urlObj.toString();
    } catch {
      return url;
    }
  }

  /**
   * 清理过期的缓存
   */
  private cleanExpiredCache(): void {
    const now = Date.now();
    for (const [key, value] of this.recentRequests.entries()) {
      if (now - value.timestamp > this.DEDUP_WINDOW_MS * 2) {
        this.recentRequests.delete(key);
      }
    }
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

      // 记录即将发送的请求信息
      console.log('🌐 [Service] 准备发起 HTTP 请求:');
      console.log('   目标URL:', dto.url);
      console.log('   协议:', isHttps ? 'HTTPS' : 'HTTP');
      console.log('   方法:', dto.method || 'GET');
      console.log('   请求头数量:', Object.keys(dto.headers || {}).length);

      // 特别记录 Cookie
      if (dto.headers && dto.headers['Cookie']) {
        console.log('🍪 [Service] 即将发送 Cookie 到目标网站:');
        console.log('   长度:', dto.headers['Cookie'].length, '字符');
        console.log('   前100字符:', dto.headers['Cookie'].substring(0, 100));
        console.log('   Cookie数量:', dto.headers['Cookie'].split(';').length, '个');
      } else if (dto.headers && dto.headers['cookie']) {
        console.log('🍪 [Service] 即将发送 cookie (小写) 到目标网站:');
        console.log('   长度:', dto.headers['cookie'].length, '字符');
        console.log('   前100字符:', dto.headers['cookie'].substring(0, 100));
      } else {
        console.log('⚠️  [Service] 警告: 请求头中没有找到 Cookie!');
        console.log('   请求头键名列表:', Object.keys(dto.headers || {}).join(', '));
      }

      // 设置 Content-Type
      if (dto.contentType && dto.body) {
        options.headers['Content-Type'] = dto.contentType;
      }

      const req = client.request(options, (res) => {
        console.log('📨 [Service] 收到目标网站响应:');
        console.log('   状态码:', res.statusCode);
        console.log('   响应头:', JSON.stringify(res.headers).substring(0, 200));

        let body = '';

        res.on('data', (chunk) => {
          body += chunk;
        });

        res.on('end', () => {
          console.log('✅ [Service] 响应接收完成:');
          console.log('   响应体长度:', body.length, '字符');
          console.log('   响应体前200字符:', body.substring(0, 200));

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
