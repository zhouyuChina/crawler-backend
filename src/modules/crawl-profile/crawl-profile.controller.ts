import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Res,
  HttpCode,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'path';
import { CrawlProfileService } from './crawl-profile.service';
import { CreateCrawlProfileDto } from './dto/create-crawl-profile.dto';
import { UpdateCrawlProfileDto } from './dto/update-crawl-profile.dto';
import { SetEnabledDto } from './dto/set-enabled.dto';
import {
  CrawlAdminGuard,
  createAdminSession,
  destroyAdminSession,
  verifyAdminToken,
} from './crawl-admin.guard';
import type { Request } from 'express';

function parseCookieToken(req: Request | undefined): string | undefined {
  if (!req) return undefined;
  const cookieHeader = req.headers?.['cookie'];
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k.trim() === 'crawl_admin_token') return v.join('=').trim();
  }
  return undefined;
}

@Controller('crawl-profiles')
export class CrawlProfileController {
  constructor(private readonly service: CrawlProfileService) {}

  // ──── 页面 ────

  @Get('page')
  getPage(@Res() res: Response) {
    res.sendFile(join(process.cwd(), 'public', 'crawl-profiles.html'));
  }

  // ──── 管理员登录 ────

  @Post('login')
  @HttpCode(200)
  adminLogin(
    @Body() body: { username: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const envUser = process.env.CRAWL_ADMIN_USERNAME;
    const envPass = process.env.CRAWL_ADMIN_PASSWORD;

    if (!envUser || !envPass) {
      throw new BadRequestException(
        '服务端未配置管理账密，请在 .env 中设置 CRAWL_ADMIN_USERNAME 和 CRAWL_ADMIN_PASSWORD',
      );
    }

    if (body.username !== envUser || body.password !== envPass) {
      return { success: false, message: '账号或密码错误' };
    }

    const token = createAdminSession();
    res.cookie('crawl_admin_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
    });
    return { success: true, message: '登录成功' };
  }

  @Post('logout')
  @HttpCode(200)
  adminLogout(
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = parseCookieToken((res as any).req);
    if (token) destroyAdminSession(token);
    res.clearCookie('crawl_admin_token');
    return { success: true };
  }

  @Get('session')
  checkSession(@Res({ passthrough: true }) res: Response) {
    const token = parseCookieToken((res as any).req);
    return { loggedIn: verifyAdminToken(token) };
  }

  // ──── 配置 CRUD（需要管理登录）────

  @Get()
  @UseGuards(CrawlAdminGuard)
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @UseGuards(CrawlAdminGuard)
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(CrawlAdminGuard)
  create(@Body() dto: CreateCrawlProfileDto) {
    return this.service.create(dto);
  }

  @Put(':id')
  @UseGuards(CrawlAdminGuard)
  update(@Param('id') id: string, @Body() dto: UpdateCrawlProfileDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/enabled')
  @UseGuards(CrawlAdminGuard)
  setEnabled(@Param('id') id: string, @Body() body: SetEnabledDto) {
    return this.service.setEnabled(id, body.enabled);
  }

  @Delete(':id')
  @UseGuards(CrawlAdminGuard)
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
  }

  @Post(':id/test-login')
  @UseGuards(CrawlAdminGuard)
  testLogin(@Param('id') id: string) {
    return this.service.testLogin(id);
  }

  @Post(':id/run-once')
  @UseGuards(CrawlAdminGuard)
  runOnce(@Param('id') id: string) {
    return this.service.runOnce(id);
  }
}
