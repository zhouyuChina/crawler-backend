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
    const url = new URL(dto.url);
    const domain = url.hostname;

    // 将浏览器请求数据转换为网页记录
    const webpage = await this.webpageService.create({
      url: dto.url,
      title: `${dto.method || 'REQUEST'} - ${dto.url}`,
      content: dto.responseBody || '',
      htmlContent: dto.responseBody || '',
      domain,
      metadata: {
        description: `${dto.method} request to ${dto.url}`,
        requestMethod: dto.method,
        statusCode: dto.statusCode,
        requestHeaders: dto.requestHeaders,
        responseHeaders: dto.responseHeaders,
      } as any,
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
    const urlMatch = htmlContent.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:url["']/i)
      || htmlContent.match(/https?:\/\/[^\s<>"]+/i);
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
    } catch (e) {
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
      } as any,
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
