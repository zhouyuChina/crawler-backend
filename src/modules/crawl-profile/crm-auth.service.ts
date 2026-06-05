import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as http from 'http';
import * as https from 'https';
import { AuthStatus, CrawlProfile } from './crawl-profile.entity';
import { TelegramNotifyService } from './telegram-notify.service';

interface LoginResult {
  success: boolean;
  cookies?: string;
  authStatus: AuthStatus;
  error?: string;
}

/** 每个 profile 的 Cookie 缓存 */
const cookieCache = new Map<string, { cookies: string; expiresAt: number }>();
const COOKIE_TTL_MS = 30 * 60 * 1000; // 30 分钟

@Injectable()
export class CrmAuthService {
  private readonly logger = new Logger(CrmAuthService.name);

  /** 由 CrmRequestSchedulerService 在初始化时注入，避免循环依赖 */
  private onCookiesSynced?: (profileId: string) => void;

  constructor(
    @InjectRepository(CrawlProfile)
    private readonly profileRepo: Repository<CrawlProfile>,
    private readonly telegramNotify: TelegramNotifyService,
  ) {}

  registerCookiesSyncedCallback(cb: (profileId: string) => void) {
    this.onCookiesSynced = cb;
  }

  /** 获取有效 Cookie，若缓存过期则重新登录 */
  async getCookies(profile: CrawlProfile): Promise<string | null> {
    const cached = cookieCache.get(profile.id);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.cookies;
    }

    const result = await this.login(profile);
    if (result.success && result.cookies) {
      cookieCache.set(profile.id, {
        cookies: result.cookies,
        expiresAt: Date.now() + COOKIE_TTL_MS,
      });
      await this.updateAuthStatus(profile, result.authStatus);
      return result.cookies;
    }

    await this.updateAuthStatus(profile, result.authStatus, result.error);
    return null;
  }

  /** 强制重新登录（忽略缓存）；若已有插件同步的 Cookie 则直接视为成功 */
  async forceLogin(profile: CrawlProfile): Promise<LoginResult> {
    const cached = cookieCache.get(profile.id);
    if (cached && Date.now() < cached.expiresAt) {
      await this.updateAuthStatus(profile, 'ok');
      return {
        success: true,
        cookies: cached.cookies,
        authStatus: 'ok',
      };
    }

    cookieCache.delete(profile.id);
    const result = await this.login(profile);
    if (result.success && result.cookies) {
      cookieCache.set(profile.id, {
        cookies: result.cookies,
        expiresAt: Date.now() + COOKIE_TTL_MS,
      });
      this.onCookiesSynced?.(profile.id);
    }
    await this.updateAuthStatus(profile, result.authStatus, result.error);
    return result;
  }

  /** 使插件提供的 Cookie 进入缓存（作为回退） */
  setPluginCookies(profileId: string, cookies: string): void {
    cookieCache.set(profileId, {
      cookies,
      expiresAt: Date.now() + COOKIE_TTL_MS,
    });
  }

  /**
   * 插件转发请求时：按 CRM 地址匹配配置，写入 Cookie 并恢复为 ok
   */
  async ingestPluginCookies(
    requestUrl: string,
    cookieHeader: string,
    responseBody?: string,
    statusCode?: number,
  ): Promise<number> {
    const cookies = cookieHeader?.trim();
    if (!cookies) return 0;

    const profiles = await this.profileRepo.find();
    const matchedProfiles = profiles.filter((profile) =>
      this.urlMatchesProfile(requestUrl, profile.baseUrl),
    );
    if (matchedProfiles.length === 0) return 0;

    if (
      (statusCode != null && statusCode >= 400) ||
      (responseBody && this.looksLikeAuthFailure(responseBody))
    ) {
      for (const profile of matchedProfiles) {
        this.invalidateCookies(profile.id);
        await this.markHumanCheckRequired(
          profile,
          '插件 Cookie 已失效，请重新在浏览器完成登录/验证',
        );
        this.logger.warn(
          `插件 Cookie 失效 → ${profile.name} (${profile.baseUrl})`,
        );
      }
      return 0;
    }

    let matched = 0;

    for (const profile of matchedProfiles) {
      this.setPluginCookies(profile.id, cookies);
      await this.markAuthOk(profile);
      // 清掉该配置的调度状态，让所有任务（包括表格）在下一次 tick 立即重跑
      this.onCookiesSynced?.(profile.id);
      matched++;
      this.logger.log(
        `已从插件同步 Cookie → ${profile.name} (${profile.baseUrl})，调度状态已重置`,
      );
    }

    return matched;
  }

  invalidateCookies(profileId: string): void {
    cookieCache.delete(profileId);
  }

  /** 内存中是否有未过期的 Cookie（含插件同步） */
  hasValidCookies(profileId: string): boolean {
    const cached = cookieCache.get(profileId);
    return !!cached && Date.now() < cached.expiresAt;
  }

  // ──────────────────── internal ────────────────────

  private async login(profile: CrawlProfile): Promise<LoginResult> {
    const { baseUrl, username, password } = profile;

    this.logger.log(`开始登录 ${baseUrl} 账号=${username}`);

    try {
      // Step 1: GET 登录页，获取 verify_key 和初始 Cookie
      const getResult = await this.httpGet(`${baseUrl}/login.php`);

      // 检测是否跳转到真人校验页
      if (
        getResult.finalUrl?.includes('verify') ||
        getResult.body.includes('verify.html')
      ) {
        this.logger.warn(`${baseUrl} 需要人工验证`);
        return {
          success: false,
          authStatus: 'human_check_required',
          error: '检测到真人校验页面，请通过插件提供 Cookie',
        };
      }

      const verifyKey = this.extractVerifyKey(getResult.body);
      const initialCookies = getResult.setCookies;

      // Step 2: POST 登录
      const postBody = new URLSearchParams({
        username,
        password,
        done: '',
        submit: '登录',
        ...(verifyKey ? { verify_key: verifyKey } : {}),
      }).toString();

      const cookieHeader = this.cookiesToHeader(initialCookies);
      const postResult = await this.httpPost(
        `${baseUrl}/logincheck.php`,
        postBody,
        {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: `${baseUrl}/login.php`,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
      );

      // 成功：302 跳转到 modules/index.php，且 Set-Cookie 包含 COOKIE_USER_ID
      const allCookies = [
        ...initialCookies,
        ...postResult.setCookies,
      ];
      const hasCookieUserId = allCookies.some((c) =>
        c.startsWith('COOKIE_USER_ID'),
      );

      if (
        postResult.finalUrl?.includes('modules/index.php') ||
        hasCookieUserId
      ) {
        const cookieStr = this.cookiesToHeader(allCookies);
        this.logger.log(`登录成功 ${baseUrl}`);
        return {
          success: true,
          cookies: cookieStr,
          authStatus: 'ok',
        };
      }

      // 检测跳转到真人校验
      if (postResult.finalUrl?.includes('verify')) {
        return {
          success: false,
          authStatus: 'human_check_required',
          error: '登录后跳转到真人校验页',
        };
      }

      // 否则账密错误
      this.logger.warn(`登录失败 ${baseUrl} 账号=${username}`);
      return {
        success: false,
        authStatus: 'login_failed',
        error: '账号或密码错误',
      };
    } catch (err: any) {
      this.logger.error(`登录异常 ${baseUrl}: ${err.message}`);
      return {
        success: false,
        authStatus: 'login_failed',
        error: err.message,
      };
    }
  }

  private urlMatchesProfile(requestUrl: string, baseUrl: string): boolean {
    try {
      const req = new URL(requestUrl);
      const base = new URL(baseUrl);
      if (req.hostname !== base.hostname) return false;
      const reqPort = req.port || (req.protocol === 'https:' ? '443' : '80');
      const basePort =
        base.port || (base.protocol === 'https:' ? '443' : '80');
      return reqPort === basePort;
    } catch {
      return false;
    }
  }

  private looksLikeAuthFailure(body: string): boolean {
    const s = body.slice(0, 8000);
    return (
      /verify\.html/i.test(s) ||
      /timeout\.php/i.test(s) ||
      /403\s*FORBIDDEN/i.test(s) ||
      (/login\.php/i.test(s) && /password|verify_key/i.test(s))
    );
  }

  private extractVerifyKey(html: string): string | null {
    const m = html.match(/verify_key['":\s]*['"]([a-zA-Z0-9_-]+)['"]/);
    return m ? m[1] : null;
  }

  private cookiesToHeader(cookies: string[]): string {
    return cookies
      .map((c) => c.split(';')[0])
      .filter(Boolean)
      .join('; ');
  }

  private async markAuthOk(profile: CrawlProfile): Promise<void> {
    const wasHumanCheck = profile.authStatus === 'human_check_required';
    await this.profileRepo.update(profile.id, {
      authStatus: 'ok',
      lastError: null,
      lastLoginAt: new Date(),
    });
    if (wasHumanCheck) {
      void this.telegramNotify.notifyHumanCheckResolved(profile);
    }
  }

  private async markHumanCheckRequired(
    profile: CrawlProfile,
    error: string,
  ): Promise<void> {
    const shouldNotify = profile.authStatus !== 'human_check_required';
    await this.profileRepo.update(profile.id, {
      authStatus: 'human_check_required',
      lastError: error,
    });
    if (shouldNotify) {
      void this.telegramNotify.notifyHumanCheckRequired(profile);
    }
  }

  private async updateAuthStatus(
    profile: CrawlProfile,
    authStatus: AuthStatus,
    error?: string,
  ) {
    const shouldNotifyRequired =
      authStatus === 'human_check_required' &&
      profile.authStatus !== 'human_check_required';
    const shouldNotifyResolved =
      authStatus === 'ok' && profile.authStatus === 'human_check_required';

    await this.profileRepo.update(profile.id, {
      authStatus,
      lastError: error ?? null,
      ...(authStatus === 'ok' ? { lastLoginAt: new Date() } : {}),
    });

    if (shouldNotifyRequired) {
      void this.telegramNotify.notifyHumanCheckRequired(profile);
    } else if (shouldNotifyResolved) {
      void this.telegramNotify.notifyHumanCheckResolved(profile);
    }
  }

  // ──────────────────── http helpers ────────────────────

  private httpGet(
    url: string,
    headers: Record<string, string> = {},
  ): Promise<{ statusCode: number; body: string; setCookies: string[]; finalUrl?: string }> {
    return this.httpRequest('GET', url, undefined, headers);
  }

  private httpPost(
    url: string,
    body: string,
    headers: Record<string, string> = {},
  ): Promise<{ statusCode: number; body: string; setCookies: string[]; finalUrl?: string }> {
    return this.httpRequest('POST', url, body, headers);
  }

  private httpRequest(
    method: string,
    urlStr: string,
    body?: string,
    headers: Record<string, string> = {},
  ): Promise<{ statusCode: number; body: string; setCookies: string[]; finalUrl?: string }> {
    return new Promise((resolve, reject) => {
      const parsed = new URL(urlStr);
      const isHttps = parsed.protocol === 'https:';
      const client = isHttps ? https : http;

      const reqHeaders: Record<string, string | number> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...headers,
      };
      if (body) {
        reqHeaders['Content-Length'] = Buffer.byteLength(body);
      }

      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: reqHeaders,
        timeout: 15000,
      };

      const req = client.request(options, (res) => {
        // 处理 302 重定向（不自动跟随，只记录 location）
        const location = res.headers['location'];
        const setCookies = (
          res.headers['set-cookie'] ?? []
        ) as string[];

        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          location
        ) {
          const finalUrl = location.startsWith('http')
            ? location
            : `${parsed.protocol}//${parsed.host}${location}`;
          resolve({
            statusCode: res.statusCode,
            body: '',
            setCookies,
            finalUrl,
          });
          res.resume();
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf-8'),
            setCookies,
          });
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('login request timeout'));
      });
      if (body) req.write(body);
      req.end();
    });
  }
}
