import { Injectable } from '@nestjs/common';
import { WebpageService } from '../webpage/webpage.service';
import { ScreenshotService } from '../screenshot/screenshot.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { PluginSubmitDto } from './dto/plugin-submit.dto';
import { BrowserRequestDto } from './dto/browser-request.dto';

@Injectable()
export class PluginDataService {
  constructor(
    private readonly webpageService: WebpageService,
    private readonly screenshotService: ScreenshotService,
    private readonly websocketGateway: WebsocketGateway,
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
    // 检查是否有数据可存储
    const hasRequestBody = dto.requestBody && dto.requestBody.trim().length > 0;
    const hasResponseBody =
      dto.responseBody && dto.responseBody.trim().length > 0;

    // 如果 requestBody 和 responseBody 都没有值，不存储到数据库
    if (!hasRequestBody && !hasResponseBody) {
      return {
        success: true,
        message: '请求已接收，但无数据需要存储',
        skipped: true,
      };
    }

    const url = new URL(dto.url);
    const domain = url.hostname;

    // 处理 requestBody：判断是 JSON 还是 HTML
    let content = '';
    let htmlContent = '';

    // 优先处理 requestBody
    if (hasRequestBody && dto.requestBody) {
      const requestBodyStr = dto.requestBody.trim();

      // 判断是否为 HTML（检查是否包含 HTML 标签）
      const isHtml =
        /^\s*<!DOCTYPE\s+html/i.test(requestBodyStr) ||
        /^\s*<html[\s>]/i.test(requestBodyStr) ||
        /<html[\s>]/i.test(requestBodyStr);

      // 判断是否为 JSON（尝试解析）
      let isJson = false;
      if (!isHtml) {
        try {
          JSON.parse(requestBodyStr);
          isJson = true;
        } catch {
          // 不是有效的 JSON
        }
      }

      if (isHtml) {
        // HTML 数据存到 htmlContent
        htmlContent = requestBodyStr;
      } else if (isJson) {
        // JSON 数据存到 content
        content = requestBodyStr;
      } else {
        // 其他类型（纯文本等）存到 content
        content = requestBodyStr;
      }
    }

    // 如果有 responseBody，也处理它
    if (hasResponseBody && dto.responseBody) {
      const responseBodyStr = dto.responseBody.trim();

      // 如果 requestBody 没有填充 htmlContent，则用 responseBody 填充
      if (!htmlContent) {
        // 判断 responseBody 是否为 HTML
        const isHtml =
          /^\s*<!DOCTYPE\s+html/i.test(responseBodyStr) ||
          /^\s*<html[\s>]/i.test(responseBodyStr) ||
          /<html[\s>]/i.test(responseBodyStr);

        if (isHtml) {
          htmlContent = responseBodyStr;
        } else if (!content) {
          // 如果 content 还没有值，则使用 responseBody
          content = responseBodyStr;
        }
      } else if (!content) {
        // 如果 htmlContent 已有值但 content 没有，则用 responseBody 填充 content
        content = responseBodyStr;
      }
    }

    // 将浏览器请求数据转换为网页记录
    const webpage = await this.webpageService.create({
      url: dto.url,
      title: `${dto.method || 'REQUEST'} - ${dto.url}`,
      content,
      htmlContent,
      domain,
      metadata: {
        description: `${dto.method} request to ${dto.url}`,
        requestMethod: dto.method,
        statusCode: dto.statusCode,
        requestHeaders: dto.requestHeaders,
        responseHeaders: dto.responseHeaders,
      } as Record<string, unknown>,
      sourcePluginId: 'browser-extension',
      browserType: 'chrome',
      capturedAt: dto.timestamp ? new Date(dto.timestamp) : new Date(),
    });

    this.websocketGateway.broadcastWebpageCreated(webpage);

    return {
      success: true,
      message: '请求已接收',
      webpageId: webpage.id,
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
}
