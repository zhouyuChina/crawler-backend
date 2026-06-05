import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import { CrawlProfile } from './crawl-profile.entity';

@Injectable()
export class TelegramNotifyService {
  private readonly logger = new Logger(TelegramNotifyService.name);

  constructor(private readonly configService: ConfigService) {}

  /** 检测到需人工验证时发送 Telegram 通知 */
  async notifyHumanCheckRequired(profile: CrawlProfile): Promise<void> {
    const crmUrl = this.normalizeCrmUrl(profile.baseUrl);
    const text = [
      '⚠️ <b>CRM 需要人工验证</b>',
      '',
      `配置：<b>${this.escapeHtml(profile.name)}</b>`,
      `账号：${this.escapeHtml(profile.username)}`,
      `地址：<a href="${this.escapeHtml(crmUrl)}">${this.escapeHtml(crmUrl)}</a>`,
      '',
      '请打开 CRM 完成登录/验证，并保持浏览器插件开启。',
    ].join('\n');

    await this.broadcast(text, `人工验证通知 → ${profile.name} (${crmUrl})`);
  }

  /** 人工验证已处理、认证恢复时发送 Telegram 通知 */
  async notifyHumanCheckResolved(profile: CrawlProfile): Promise<void> {
    const crmUrl = this.normalizeCrmUrl(profile.baseUrl);
    const text = [
      '✅ <b>CRM 人工验证已处理</b>',
      '',
      `配置：<b>${this.escapeHtml(profile.name)}</b>`,
      `账号：${this.escapeHtml(profile.username)}`,
      `地址：<a href="${this.escapeHtml(crmUrl)}">${this.escapeHtml(crmUrl)}</a>`,
      '',
      '认证已恢复，抓取任务将自动继续。',
    ].join('\n');

    await this.broadcast(text, `验证恢复通知 → ${profile.name} (${crmUrl})`);
  }

  private getConfig(): { botToken: string; chatIds: string[] } | null {
    const botToken = this.configService.get<string>('telegram.botToken') ?? '';
    const chatIds = this.configService.get<string[]>('telegram.chatIds') ?? [];

    if (!botToken || chatIds.length === 0) {
      this.logger.debug(
        'Telegram 未配置（TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_IDS），跳过通知',
      );
      return null;
    }

    return { botToken, chatIds };
  }

  private async broadcast(text: string, successLog: string): Promise<void> {
    const config = this.getConfig();
    if (!config) return;

    const results = await Promise.allSettled(
      config.chatIds.map((chatId) =>
        this.sendMessage(config.botToken, chatId, text),
      ),
    );

    let sent = 0;
    results.forEach((result, index) => {
      const chatId = config.chatIds[index];
      if (result.status === 'fulfilled') {
        sent++;
        return;
      }
      this.logger.error(
        `Telegram 通知失败 chat_id=${chatId}: ${result.reason?.message ?? result.reason}`,
      );
    });

    if (sent > 0) {
      this.logger.log(`已发送 ${successLog}（${sent}/${config.chatIds.length}）`);
    }
  }

  private normalizeCrmUrl(baseUrl: string): string {
    const trimmed = baseUrl.trim().replace(/\/+$/, '');
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    return `http://${trimmed}`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private sendMessage(
    botToken: string,
    chatId: string,
    text: string,
  ): Promise<void> {
    const body = JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.telegram.org',
          port: 443,
          path: `/bot${botToken}/sendMessage`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 10000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf-8');
            if ((res.statusCode ?? 0) >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
              return;
            }
            try {
              const parsed = JSON.parse(raw) as {
                ok?: boolean;
                description?: string;
              };
              if (!parsed.ok) {
                reject(new Error(parsed.description || raw));
                return;
              }
            } catch {
              reject(new Error(raw));
              return;
            }
            resolve();
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('telegram request timeout'));
      });
      req.write(body);
      req.end();
    });
  }
}
