import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@max-promotion/contracts';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';
import type { AuthUser } from './auth.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;

    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: AuthUser;
    }>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('请先登录');

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(header.slice(7));
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || user.status !== 'ACTIVE' || user.role === 'MERCHANT') {
        throw new UnauthorizedException('账号不可用');
      }
      request.user = {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      };
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('登录已过期，请重新登录');
    }
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!request.user || !roles.includes(request.user.role)) {
      throw new ForbiddenException('当前账号没有此操作权限');
    }
    return true;
  }
}
