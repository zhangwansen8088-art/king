import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { SessionUser } from '@max-promotion/contracts';
import { CurrentUser } from './common/decorators';

@ApiTags('认证')
@ApiBearerAuth()
@Controller()
export class MeController {
  @Get('me')
  me(@CurrentUser() user: SessionUser): SessionUser {
    return user;
  }
}
