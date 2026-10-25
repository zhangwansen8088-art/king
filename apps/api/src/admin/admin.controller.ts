import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, Roles } from '../common/decorators';
import {
  AdjustWalletDto,
  AuditLogQueryDto,
  CreateMerchantDto,
  CreateTaskDto,
  ReviewSubmissionDto,
  ReviewWithdrawalDto,
  TaskQueryDto,
  UpdateMerchantDto,
  UpdateTaskStatusDto,
} from './admin.dto';
import { AdminService } from './admin.service';

@ApiBearerAuth()
@ApiTags('管理员后台')
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  @Get('merchants')
  merchants() {
    return this.admin.merchants();
  }

  @Post('merchants')
  createMerchant(@CurrentUser() user: AuthUser, @Body() body: CreateMerchantDto) {
    return this.admin.createMerchant(user.id, body);
  }

  @Patch('merchants/:id')
  updateMerchant(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMerchantDto,
  ) {
    return this.admin.updateMerchant(user.id, id, body);
  }

  @Get('tasks')
  tasks(@Query() query: TaskQueryDto) {
    return this.admin.tasks(query);
  }

  @Post('tasks')
  createTask(@CurrentUser() user: AuthUser, @Body() body: CreateTaskDto) {
    return this.admin.createTask(user.id, body);
  }

  @Patch('tasks/:id/status')
  updateTaskStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateTaskStatusDto,
  ) {
    return this.admin.updateTaskStatus(user.id, id, body.status);
  }

  @Get('submissions')
  submissions() {
    return this.admin.submissions();
  }

  @Post('submissions/:id/review')
  reviewSubmission(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReviewSubmissionDto,
  ) {
    return this.admin.reviewSubmission(user.id, id, body);
  }

  @Get('wallets')
  wallets() {
    return this.admin.wallets();
  }

  @Post('wallets/:userId/adjust')
  adjustWallet(
    @CurrentUser() user: AuthUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: AdjustWalletDto,
  ) {
    return this.admin.adjustWallet(user.id, userId, body);
  }

  @Get('withdrawals')
  withdrawals() {
    return this.admin.withdrawals();
  }

  @Post('withdrawals/:id/review')
  reviewWithdrawal(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReviewWithdrawalDto,
  ) {
    return this.admin.reviewWithdrawal(user.id, id, body);
  }

  @Get('audit-logs')
  auditLogs(@Query() query: AuditLogQueryDto) {
    return this.admin.auditLogs(query);
  }
}
