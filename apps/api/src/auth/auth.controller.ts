import { Body, Controller, ForbiddenException, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { AuthSession, SessionUser } from '@max-promotion/contracts';
import { Public } from '../common/decorators';
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
      request.ip ?? '',
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
        request.ip ?? '',
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

  private csrfFromRequest(request: Request): string | undefined {
    const header = request.get('x-csrf-token');
    const cookie = request.cookies?.[this.env.csrfCookieName] as string | undefined;
    return header && cookie && header === cookie ? header : undefined;
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
