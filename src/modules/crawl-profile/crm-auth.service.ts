import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
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

/** 登录锁：同一 profile 同时只允许一个登录请求在飞，避免并发重复登录 */
const loginLock = new Map<string, Promise<string | null>>();

@Injectable()
export class CrmAuthService implements OnModuleInit {
  private readonly logger = new Logger(CrmAuthService.name);

  /** 由 CrmRequestSchedulerService 在初始化时注入，避免循环依赖 */
  private onCookiesSynced?: (profileId: string) => void;
  private onAuthStatusChanged?: (profileId: string) => void;
  /** 已发送「需人工验证」通知的 profile，恢复 ok 后清除 */
  private readonly humanCheckNotified = new Set<string>();

  constructor(
    @InjectRepository(CrawlProfile)
    private readonly profileRepo: Repository<CrawlProfile>,
    private readonly telegramNotify: TelegramNotifyService,
  ) {}

  registerCookiesSyncedCallback(cb: (profileId: string) => void) {
    this.onCookiesSynced = cb;
  }

  registerAuthStatusChangedCallback(cb: (profileId: string) => void) {
    this.onAuthStatusChanged = cb;
  }

  async onModuleInit() {
    const pending = await this.profileRepo.find({
      where: { authStatus: 'human_check_required' },
      select: ['id'],
    });
    for (const profile of pending) {
      this.humanCheckNotified.add(profile.id);
    }
  }

  /** 获取有效 Cookie，若缓存过期则重新登录（同一 profile 加锁，避免并发重复登录） */
  async getCookies(profile: CrawlProfile): Promise<string | null> {
    const cached = cookieCache.get(profile.id);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.cookies;
    }

    // 已有登录请求在飞：等待它的结果，不重复发起
    const existing = loginLock.get(profile.id);
    if (existing) {
      return existing;
    }

    const promise = this.doLogin(profile).finally(() => {
      loginLock.delete(profile.id);
    });
    loginLock.set(profile.id, promise);
    return promise;
  }

  private async doLogin(profile: CrawlProfile): Promise<string | null> {
    const fresh = await this.profileRepo.findOne({
      where: { id: profile.id },
      select: ['id', 'authStatus'],
    });
    if (
      fresh?.authStatus === 'human_check_required' &&
      !this.hasValidCookies(profile.id)
    ) {
      return null;
    }

    const result = await this.login(profile);
    if (result.success && result.cookies) {
      cookieCache.set(profile.id, {
        cookies: result.cookies,
        expiresAt: Date.now() + COOKIE_TTL_MS,
      });
      await this.updateAuthStatus(profile, result.authStatus, undefined, true);
      return result.cookies;
    }

    await this.updateAuthStatus(profile, result.authStatus, result.error, true);
    return null;
  }

  /** 强制重新登录（忽略缓存）；若已有插件同步的 Cookie 则直接视为成功 */
  async forceLogin(profile: CrawlProfile): Promise<LoginResult> {
    const cached = cookieCache.get(profile.id);
    if (cached && Date.now() < cached.expiresAt) {
      // 缓存命中不视为"重新登录"，不刷新 lastLoginAt
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
    await this.updateAuthStatus(profile, result.authStatus, result.error, true);
    return result;
  }

  /** 使插件提供的 Cookie 进入缓存（作为回退），返回 Cookie 是否发生变化 */
  setPluginCookies(profileId: string, cookies: string): boolean {
    const cached = cookieCache.get(profileId);
    const changed = cached?.cookies !== cookies;
    cookieCache.set(profileId, {
      cookies,
      expiresAt: Date.now() + COOKIE_TTL_MS,
    });
    return changed;
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
      const cookieChanged = this.setPluginCookies(profile.id, cookies);
      const restored = await this.markAuthOk(profile);
      // 只有真正恢复登录或 Cookie 变化时才重置调度状态，避免每个普通请求都打乱间隔
      if (restored || cookieChanged) {
        this.onCookiesSynced?.(profile.id);
      }
      matched++;
      this.logger.log(
        `已从插件同步 Cookie → ${profile.name} (${profile.baseUrl})${
          restored || cookieChanged ? '，调度状态已重置' : ''
        }`,
      );
    }

    return matched;
  }

  invalidateCookies(profileId: string): void {
    cookieCache.delete(profileId);
  }

  /** 请求成功说明当前 Cookie 仍有效，续期缓存，避免固定 TTL 到点后主动重新登录 */
  touchCookies(profileId: string): void {
    const cached = cookieCache.get(profileId);
    if (!cached) return;
    cookieCache.set(profileId, {
      cookies: cached.cookies,
      expiresAt: Date.now() + COOKIE_TTL_MS,
    });
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
      // Step 1: GET 登录页，获取 verify_key 和初始 Cookie（部分 CRM 在 /，部分在 /login.php）
      const { page: loginPageUrl, result: getResult } =
        await this.fetchLoginPage(baseUrl);

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
      if (!verifyKey) {
        this.logger.warn(
          `登录页未提取到 verify_key ${loginPageUrl} 账号=${username}`,
        );
      }
      const initialCookies = getResult.setCookies;

      // Step 2: POST 登录（字段与浏览器表单一致：done=submit_log, submit=GO...）
      const postBody = new URLSearchParams({
        username,
        password,
        done: 'submit_log',
        submit: 'GO...',
        ...(verifyKey ? { verify_key: verifyKey } : {}),
      }).toString();

      const cookieHeader = this.cookiesToHeader(initialCookies);
      const postResult = await this.httpPost(
        `${baseUrl}/logincheck.php`,
        postBody,
        {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: loginPageUrl,
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
      this.logger.warn(
        `登录失败 ${baseUrl} 账号=${username} status=${postResult.statusCode} finalUrl=${postResult.finalUrl ?? '-'} cookies=${allCookies
          .map((c) => c.split('=')[0])
          .join(',') || '-'}`,
      );
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

  /** 依次尝试 / 与 /login.php，返回可用登录页 URL 及响应 */
  private async fetchLoginPage(baseUrl: string): Promise<{
    page: string;
    result: {
      statusCode: number;
      body: string;
      setCookies: string[];
      finalUrl?: string;
    };
  }> {
    const candidates = [`${baseUrl}/`, `${baseUrl}/login.php`];
    let fallback: { page: string; result: Awaited<ReturnType<typeof this.httpGet>> } | null =
      null;
    for (const page of candidates) {
      const result = await this.httpGet(page);
      if (result.statusCode === 200 && this.extractVerifyKey(result.body)) {
        return { page, result };
      }
      if (result.statusCode === 200 && !fallback) {
        fallback = { page, result };
      }
    }
    return fallback ?? { page: candidates[0], result: await this.httpGet(candidates[0]) };
  }

  private extractVerifyKey(html: string): string | null {
    const inputMatch = html.match(
      /<input\b[^>]*\bname=["']verify_key["'][^>]*\bvalue=["']([^"']+)["'][^>]*>/i,
    );
    if (inputMatch) return inputMatch[1];

    const valueFirstMatch = html.match(
      /<input\b[^>]*\bvalue=["']([^"']+)["'][^>]*\bname=["']verify_key["'][^>]*>/i,
    );
    if (valueFirstMatch) return valueFirstMatch[1];

    const scriptMatch = html.match(/verify_key['":\s]*['"]([a-zA-Z0-9_-]+)['"]/);
    return scriptMatch ? scriptMatch[1] : null;
  }

  private cookiesToHeader(cookies: string[]): string {
    return cookies
      .map((c) => c.split(';')[0])
      .filter(Boolean)
      .join('; ');
  }

  private async markAuthOk(profile: CrawlProfile): Promise<boolean> {
    const current = await this.profileRepo.findOne({
      where: { id: profile.id },
      select: ['authStatus'],
    });
    const previousStatus = current?.authStatus ?? profile.authStatus;
    const wasNotOk = previousStatus !== 'ok';

    await this.profileRepo.update(profile.id, {
      authStatus: 'ok',
      lastError: null,
      // 只有从非 ok 状态恢复时才刷新登录时间，常规 Cookie 同步不计为"登录"
      ...(wasNotOk ? { lastLoginAt: new Date() } : {}),
    });
    this.humanCheckNotified.delete(profile.id);
    if (previousStatus === 'human_check_required') {
      void this.telegramNotify.notifyHumanCheckResolved(profile);
      this.onAuthStatusChanged?.(profile.id);
    }
    return wasNotOk;
  }

  private async markHumanCheckRequired(
    profile: CrawlProfile,
    error: string,
  ): Promise<void> {
    const current = await this.profileRepo.findOne({
      where: { id: profile.id },
      select: ['authStatus'],
    });
    const wasAlready = current?.authStatus === 'human_check_required';

    await this.profileRepo.update(profile.id, {
      authStatus: 'human_check_required',
      lastError: error,
    });

    if (!wasAlready) {
      void this.notifyHumanCheckRequiredOnce(profile);
      this.onAuthStatusChanged?.(profile.id);
    }
  }

  private async updateAuthStatus(
    profile: CrawlProfile,
    authStatus: AuthStatus,
    error?: string,
    /** 只有真正发起过登录请求时才传 true，从缓存命中不传 */
    actualLogin = false,
  ) {
    const current = await this.profileRepo.findOne({
      where: { id: profile.id },
      select: ['authStatus'],
    });
    const previousStatus = current?.authStatus ?? profile.authStatus;
    const shouldNotifyRequired =
      authStatus === 'human_check_required' &&
      previousStatus !== 'human_check_required';
    const shouldNotifyResolved =
      authStatus === 'ok' && previousStatus === 'human_check_required';

    await this.profileRepo.update(profile.id, {
      authStatus,
      lastError: error ?? null,
      ...(authStatus === 'ok' && actualLogin ? { lastLoginAt: new Date() } : {}),
    });

    if (shouldNotifyRequired) {
      void this.notifyHumanCheckRequiredOnce(profile);
    } else if (shouldNotifyResolved) {
      this.humanCheckNotified.delete(profile.id);
      void this.telegramNotify.notifyHumanCheckResolved(profile);
    }

    if (shouldNotifyRequired || shouldNotifyResolved) {
      this.onAuthStatusChanged?.(profile.id);
    }
  }

  private notifyHumanCheckRequiredOnce(profile: CrawlProfile): void {
    if (this.humanCheckNotified.has(profile.id)) return;
    this.humanCheckNotified.add(profile.id);
    void this.telegramNotify.notifyHumanCheckRequired(profile);
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
            : `${parsed.protocol}//${parsed.host}${
                location.startsWith('/') ? '' : '/'
              }${location}`;
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
