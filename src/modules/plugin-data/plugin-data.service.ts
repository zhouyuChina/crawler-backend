import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { WebpageService } from '../webpage/webpage.service';
import { ScreenshotService } from '../screenshot/screenshot.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { CallRecordService } from '../call-record/call-record.service';
import { CrmAuthService } from '../crawl-profile/crm-auth.service';
import { PluginSubmitDto } from './dto/plugin-submit.dto';
import { ProxyRequestDto } from './dto/proxy-request.dto';
import { v4 as uuidv4 } from 'uuid';
import * as http from 'http';
import * as https from 'https';
import * as zlib from 'zlib';

const DUPLICATE_WEBPAGE_SAMPLE_MS = 60 * 1000;
const RESPONSE_BODY_PREVIEW_LIMIT = 8 * 1024;

@Injectable()
export class PluginDataService {
  private readonly lastPersistedContents = new Map<string, string>();
  private readonly lastDuplicateSampleAt = new Map<string, number>();

  constructor(
    private readonly webpageService: WebpageService,
    private readonly screenshotService: ScreenshotService,
    private readonly websocketGateway: WebsocketGateway,
    private readonly callRecordService: CallRecordService,
    @Inject(forwardRef(() => CrmAuthService))
    private readonly crmAuthService: CrmAuthService,
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
    const requestId = uuidv4();
    const timestamp = new Date().toISOString();
    const method = dto.method || 'GET';
    const sourcePluginId = dto.sourcePluginId || 'browser-extension-proxy';

    this.websocketGateway.broadcastRequestReceived({
      id: requestId,
      url: dto.url,
      method,
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

      const recordType = this.identifyRecordType(dto.url);
      const responseContent = content || htmlContent;
      const responseBodyPreview = this.buildResponseBodyPreview(
        responseData.body,
        recordType,
      );
      const shouldPersistWebpage = this.shouldPersistWebpage(
        recordType,
        responseContent,
      );

      const webpage = shouldPersistWebpage
        ? await this.webpageService.create({
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
            sourcePluginId,
            browserType: 'chrome',
            capturedAt: new Date(),
          })
        : null;

      if (webpage) {
        this.websocketGateway.broadcastWebpageCreated(webpage);
      }

      this.websocketGateway.broadcastRequestProcessed({
        id: requestId,
        url: dto.url,
        method,
        status: 'success',
        message: webpage
          ? `代理请求成功，状态码: ${responseData.statusCode}`
          : `代理请求成功，状态码: ${responseData.statusCode}（重复内容未落库）`,
        webpageId: webpage?.id,
        responseBody:
          sourcePluginId === 'crawl-profile-scheduler'
            ? responseBodyPreview
            : responseData.body,
        statusCode: responseData.statusCode,
      });

      // 判断是否是 call-record 类型，如果是则触发专门的事件
      if (recordType) {
        if (webpage) {
          // 记录通话更新时间（用于判断通话是否结束）
          if (!this.hasNoCallRecord(responseContent)) {
            this.callRecordService.recordCallUpdate(recordType, webpage.id);
          }

          // 检查是否与最新记录重复
          const shouldBroadcast =
            await this.callRecordService.shouldBroadcastRecord(
              recordType,
              webpage.content || webpage.htmlContent,
              webpage.id,
            );

          if (shouldBroadcast) {
            this.websocketGateway.broadcastCallRecordCreated({
              id: webpage.id,
              recordType,
              url: webpage.url,
              content: webpage.content || webpage.htmlContent,
              statusCode: responseData.statusCode,
              timestamp: webpage.createdAt.toISOString(),
            });
          } else {
            console.log(`⏭️  跳过重复记录推送: ${recordType} (${webpage.id})`);
          }
        } else {
          if (!this.hasNoCallRecord(responseContent)) {
            this.callRecordService.recordCallHeartbeat(recordType);
          }
          console.log(`⏭️  跳过重复网页落库: ${recordType}`);
        }
      }

      const cookieHeader = this.extractCookieHeader(dto.headers);
      const shouldIngestCookies = sourcePluginId !== 'crawl-profile-scheduler';
      if (cookieHeader && shouldIngestCookies) {
        void this.crmAuthService
          .ingestPluginCookies(
            dto.url,
            cookieHeader,
            responseData.body,
            responseData.statusCode,
          )
          .catch(() => {});
      }

      return {
        success: true,
        message: '代理请求成功',
        webpageId: webpage?.id,
        skippedWebpagePersist: !webpage,
        statusCode: responseData.statusCode,
        responseBody:
          sourcePluginId === 'crawl-profile-scheduler'
            ? responseBodyPreview
            : responseData.body,
        responseHeaders: responseData.headers,
      };
    } catch (error: any) {
      this.websocketGateway.broadcastRequestProcessed({
        id: requestId,
        url: dto.url,
        method,
        status: 'error',
        error: error?.message || '代理请求失败',
      });
      throw error;
    }
  }

  private extractCookieHeader(
    headers?: Record<string, string>,
  ): string | undefined {
    if (!headers) return undefined;
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === 'cookie' && value) return value;
    }
    return undefined;
  }

  private shouldPersistWebpage(
    recordType: string | null,
    content: string,
  ): boolean {
    if (!recordType) return true;

    const lastContent = this.lastPersistedContents.get(recordType);
    if (lastContent !== content) {
      this.lastPersistedContents.set(recordType, content);
      this.lastDuplicateSampleAt.set(recordType, Date.now());
      return true;
    }

    const now = Date.now();
    const lastSampleAt = this.lastDuplicateSampleAt.get(recordType) ?? 0;
    if (now - lastSampleAt >= DUPLICATE_WEBPAGE_SAMPLE_MS) {
      this.lastDuplicateSampleAt.set(recordType, now);
      return true;
    }

    return false;
  }

  private hasNoCallRecord(content: string): boolean {
    return content.includes('無任何通話記錄');
  }

  private buildResponseBodyPreview(
    body: string,
    recordType: string | null,
  ): string | undefined {
    if (!body) return undefined;

    // 高频轮询请求只需要状态和落库结果，不应通过 WS 携带完整 HTML。
    if (recordType) {
      return `[omitted high-frequency response: ${body.length} chars]`;
    }

    if (body.length <= RESPONSE_BODY_PREVIEW_LIMIT) {
      return body;
    }

    return `${body.slice(0, RESPONSE_BODY_PREVIEW_LIMIT)}\n...[truncated ${body.length - RESPONSE_BODY_PREVIEW_LIMIT} chars]`;
  }

  /**
   * 识别 URL 中的记录类型
   */
  private identifyRecordType(url: string): string | null {
    const keywords = [
      'get_peer_status',
      'cont_controler',
      'get_curcall_in',
      'get_curcall_out',
    ];

    for (const keyword of keywords) {
      if (url.includes(keyword)) {
        return keyword;
      }
    }

    return null;
  }

  /**
   * 代理请求不转发 Accept-Encoding，避免 Node http 收到 gzip 却无法解压导致乱码
   */
  private sanitizeProxyHeaders(
    headers: Record<string, string> = {},
  ): Record<string, string> {
    const sanitized: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === 'accept-encoding') {
        continue;
      }
      sanitized[name] = value;
    }
    return sanitized;
  }

  /**
   * 按 Content-Encoding 解压响应体并解码为字符串
   */
  private decodeResponseBody(
    raw: Buffer,
    contentEncoding?: string | string[],
    contentType?: string | string[],
  ): string {
    let buf = raw;
    const encoding = String(contentEncoding || '').toLowerCase();

    if (encoding.includes('gzip')) {
      buf = zlib.gunzipSync(buf);
    } else if (encoding.includes('deflate')) {
      buf = zlib.inflateSync(buf);
    } else if (encoding.includes('br')) {
      buf = zlib.brotliDecompressSync(buf);
    }

    const typeStr = String(
      Array.isArray(contentType) ? contentType[0] : contentType || '',
    );
    const charsetMatch = typeStr.match(/charset=([^;\s]+)/i);
    const charset = (charsetMatch?.[1] || 'utf-8').trim().toLowerCase();
    const normalizedCharset =
      charset === 'utf8' ? 'utf-8' : charset.replace(/_/g, '-');

    return buf.toString(normalizedCharset as BufferEncoding);
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

      const headers = this.sanitizeProxyHeaders(
        (dto.headers || {}) as Record<string, string>,
      );

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: dto.method || 'GET',
        headers,
        timeout: 30000, // 30 秒超时
      };

      // 设置 Content-Type
      if (dto.contentType && dto.body) {
        options.headers['Content-Type'] = dto.contentType;
      }

      const req = client.request(options, (res) => {
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const body = this.decodeResponseBody(
            raw,
            res.headers['content-encoding'],
            res.headers['content-type'],
          );

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
