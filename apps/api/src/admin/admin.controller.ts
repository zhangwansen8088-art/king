import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../common/auth.types';
import { CurrentUser, Roles } from '../common/decorators';
import {
  AdjustWalletDto,
  AuditLogQueryDto,
  CreateMerchantDto,
  CreateTaskDto,
  MerchantExportQueryDto,
  MerchantQueryDto,
  ReviewSubmissionDto,
  ReviewWithdrawalDto,
  SubmissionQueryDto,
  TaskQueryDto,
  UpdateMerchantDto,
  UpdateTaskStatusDto,
  WalletQueryDto,
  WithdrawalQueryDto,
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

  @Get('merchant-profiles')
  merchantProfiles(@Query() query: MerchantQueryDto) {
    return this.admin.merchantProfiles(query);
  }

  @Get('merchant-profiles/export')
  async exportMerchantProfiles(
    @Query() query: MerchantExportQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const csv = await this.admin.merchantProfilesCsv(query);
    const dateStamp = new Date().toISOString().slice(0, 10);
    const filename = `商户资料-${dateStamp}.csv`;

    // 固定附件名称并提供 UTF-8 文件名，兼容中文浏览器与 Excel。
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="merchant-profiles-${dateStamp}.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Length', Buffer.byteLength(csv, 'utf8'));
    response.status(200).send(csv);
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
  submissions(@Query() query: SubmissionQueryDto) {
    return this.admin.submissions(query);
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
  wallets(@Query() query: WalletQueryDto) {
    return this.admin.wallets(query);
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
  withdrawals(@Query() query: WithdrawalQueryDto) {
    return this.admin.withdrawals(query);
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
