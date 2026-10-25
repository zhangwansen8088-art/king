import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../common/decorators';
import type { AuthUser } from '../common/auth.types';
import { PromoterService } from './promoter.service';
import { CreateWithdrawalDto, SubmitProofDto } from './promoter.dto';

@ApiBearerAuth()
@ApiTags('推广客户')
@Roles('PROMOTER')
@Controller('promoter')
export class PromoterController {
  constructor(private readonly promoter: PromoterService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.promoter.dashboard(user.id);
  }

  @Post('claims')
  claim(@CurrentUser() user: AuthUser) {
    return this.promoter.claimRandom(user.id);
  }

  @Post('submissions/:id')
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SubmitProofDto,
  ) {
    return this.promoter.submitProof(user.id, id, body);
  }

  @Get('withdrawals/status')
  withdrawalStatus(@CurrentUser() user: AuthUser) {
    return this.promoter.withdrawalStatus(user.id);
  }

  @Post('withdrawals')
  withdraw(@CurrentUser() user: AuthUser, @Body() body: CreateWithdrawalDto) {
    return this.promoter.requestWithdrawal(user.id, body);
  }
}
