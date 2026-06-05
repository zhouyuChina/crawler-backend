import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

/** 简单的内存 session 存储，token -> expireAt */
const sessions = new Map<string, number>();
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 小时

export function createAdminSession(): string {
  const token =
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

export function destroyAdminSession(token: string): void {
  sessions.delete(token);
}

export function verifyAdminToken(token: string | undefined): boolean {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(token);
    return false;
  }
  return true;
}

/** 从 cookie header 或 Authorization header 中提取 token */
function extractToken(req: Request): string | undefined {
  // 手动解析 Cookie header，不依赖 cookie-parser 中间件
  const cookieHeader = req.headers['cookie'];
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k.trim() === 'crawl_admin_token') return v.join('=').trim();
    }
  }
  const auth = req.headers['authorization'];
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return undefined;
}

@Injectable()
export class CrawlAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const token = extractToken(req);
    if (!verifyAdminToken(token)) {
      throw new UnauthorizedException('请先登录配置管理页面');
    }
    return true;
  }
}
