import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { SessionUser } from '@max-promotion/contracts';
import type { AuthUser } from './common/auth.types';
import { CurrentUser } from './common/decorators';

@ApiTags('认证')
@ApiBearerAuth()
@Controller()
export class MeController {
  @Get('me')
  me(@CurrentUser() user: AuthUser): SessionUser {
    // 不把仅供服务端校验的会话标识暴露给前端用户资料接口。
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    };
  }
}
