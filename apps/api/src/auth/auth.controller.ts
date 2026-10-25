import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthSession, AuthSessionRecord, SessionUser } from '@max-promotion/contracts';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, Public } from '../common/decorators';
import { loadEnv } from '../config/env';
import { AuthService } from './auth.service';
import { LoginDto } from './auth.dto';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  private readonly env = loadEnv();

  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSession> {
    this.assertOrigin(request);
    const session = await this.auth.login(
      body.username,
      body.password,
      request.get('user-agent') ?? '',
      this.clientIp(request),
    );
    this.writeCookies(response, session.refreshToken, session.csrfToken, session.refreshExpiresAt);
    return {
      accessToken: session.accessToken,
      csrfToken: session.csrfToken,
      user: session.user,
    };
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSession> {
    this.assertOrigin(request);
    try {
      const session = await this.auth.refresh(
        request.cookies?.[this.env.refreshCookieName] as string | undefined,
        this.csrfFromRequest(request),
        request.get('user-agent') ?? '',
        this.clientIp(request),
      );
      this.writeCookies(
        response,
        session.refreshToken,
        session.csrfToken,
        session.refreshExpiresAt,
      );
      return {
        accessToken: session.accessToken,
        csrfToken: session.csrfToken,
        user: session.user,
      };
    } catch (error) {
      this.clearCookies(response);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ success: true }> {
    this.assertOrigin(request);
    await this.auth.logout(
      request.cookies?.[this.env.refreshCookieName] as string | undefined,
      this.csrfFromRequest(request),
    );
    this.clearCookies(response);
    return { success: true };
  }

  @ApiBearerAuth()
  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser): Promise<AuthSessionRecord[]> {
    return this.auth.listSessions(user.id, user.sessionId);
  }

  @ApiBearerAuth()
  @Post('sessions/:id/revoke')
  async revokeSession(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) sessionId: string,
    @Req() request: Request,
  ): Promise<{ success: true }> {
    this.assertOrigin(request);
    await this.auth.revokeSession(user.id, sessionId);
    return { success: true };
  }

  private csrfFromRequest(request: Request): string | undefined {
    const header = request.get('x-csrf-token');
    const cookie = request.cookies?.[this.env.csrfCookieName] as string | undefined;
    return header && cookie && header === cookie ? header : undefined;
  }

  /**
   * Express 仅在来源命中可信代理网段时采用 X-Forwarded-For；
   * 否则始终使用 TCP 连接地址，防止客户端伪造来源绕过限速。
   */
  private clientIp(request: Request): string {
    return request.ip?.trim() || request.socket.remoteAddress?.trim() || 'unknown';
  }

  private assertOrigin(request: Request): void {
    const origin = request.get('origin');
    if (origin && origin !== this.env.webOrigin) {
      throw new ForbiddenException('请求来源不受信任');
    }
  }

  private writeCookies(
    response: Response,
    refreshToken: string,
    csrfToken: string,
    expires: Date,
  ): void {
    response.cookie(this.env.refreshCookieName, refreshToken, {
      httpOnly: true,
      secure: this.env.cookieSecure,
      sameSite: 'lax',
      path: '/api/auth',
      expires,
    });
    response.cookie(this.env.csrfCookieName, csrfToken, {
      httpOnly: false,
      secure: this.env.cookieSecure,
      sameSite: 'lax',
      path: '/',
      expires,
    });
  }

  private clearCookies(response: Response): void {
    response.clearCookie(this.env.refreshCookieName, { path: '/api/auth' });
    response.clearCookie(this.env.csrfCookieName, { path: '/' });
  }
}
