import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsBoolean,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const money = { message: '金额必须是字符串形式的整数分' };

export class AuditLogQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({ description: '按动作模糊筛选，不区分大小写' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({ description: '按实体类型模糊筛选，不区分大小写' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityType?: string;
}

export class CreateMerchantDto {
  @ApiProperty({ example: '青禾茶饮' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  companyName!: string;

  @ApiProperty({ example: '青禾茶饮（运营名）' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName!: string;

  @ApiProperty({ example: '陈经理' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  contactName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  note?: string;
}

export class UpdateMerchantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  companyName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  contactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  contactPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  note?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';
}

export class MerchantQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'], description: '按商户账号状态筛选' })
  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';

  @ApiPropertyOptional({ description: '按公司名称、联系人、联系电话或账号名称模糊筛选' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class MerchantExportQueryDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'DISABLED'], description: '按商户账号状态筛选' })
  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';

  @ApiPropertyOptional({ description: '按公司名称、联系人、联系电话或账号名称模糊筛选' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CreateTaskDto {
  @ApiProperty({ description: '前端生成的请求 UUID，用于防重复发布' })
  @IsUUID()
  requestId!: string;

  @ApiProperty({ description: '商户资料 ID' })
  @IsUUID()
  merchantId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  description?: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(1_000)
  adContent!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  publicPoints!: string;

  @ApiProperty({ description: '管理员确认已取得数据提供方对广告内容的确认' })
  @IsBoolean()
  merchantConfirmed!: boolean;

  @ApiProperty({
    description: '商户确认依据，例如确认人、渠道、时间和回执编号',
    example: '2026-10-25 09:30 与陈经理电话确认，回执号 M-1025-01',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  merchantConfirmation!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  region!: string;

  @ApiProperty({ example: '100000', description: '单笔广告费，字符串整数分' })
  @Matches(/^\d+$/, money)
  adFeeCents!: string;

  @ApiProperty({ enum: ['NORMAL', 'WELFARE'] })
  @IsIn(['NORMAL', 'WELFARE'])
  rewardType!: 'NORMAL' | 'WELFARE';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  welfareClaimRule?: string;

  @ApiProperty({ example: 100 })
  @IsInt()
  @Min(1)
  @Max(10_000)
  maxClaims!: number;

  @ApiProperty({ example: '2026-10-25T10:00:00+08:00' })
  @IsISO8601({ strict: true })
  startsAt!: string;

  @ApiProperty({ example: '2026-11-01T22:00:00+08:00' })
  @IsISO8601({ strict: true })
  endsAt!: string;
}

export class UpdateTaskStatusDto {
  @ApiProperty({ enum: ['OPEN', 'PAUSED', 'ENDED'] })
  @IsIn(['OPEN', 'PAUSED', 'ENDED'])
  status!: 'OPEN' | 'PAUSED' | 'ENDED';
}

export class TaskQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({ enum: ['OPEN', 'PAUSED', 'ENDED'], description: '按任务状态筛选' })
  @IsOptional()
  @IsIn(['OPEN', 'PAUSED', 'ENDED'])
  status?: 'OPEN' | 'PAUSED' | 'ENDED';
}

export class SubmissionQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({
    enum: ['CLAIMED', 'SUBMITTED', 'APPROVED', 'REJECTED'],
    description: '按凭证审核状态筛选',
  })
  @IsOptional()
  @IsIn(['CLAIMED', 'SUBMITTED', 'APPROVED', 'REJECTED'])
  status?: 'CLAIMED' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
}

export class WithdrawalQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({
    enum: ['PENDING', 'PAID', 'REJECTED'],
    description: '按提现处理状态筛选',
  })
  @IsOptional()
  @IsIn(['PENDING', 'PAID', 'REJECTED'])
  status?: 'PENDING' | 'PAID' | 'REJECTED';
}

export class WalletQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @ApiPropertyOptional({
    enum: ['PROMOTER', 'MERCHANT'],
    description: '按资金账户所属角色筛选',
  })
  @IsOptional()
  @IsIn(['PROMOTER', 'MERCHANT'])
  role?: 'PROMOTER' | 'MERCHANT';

  @ApiPropertyOptional({
    enum: ['ACTIVE', 'DISABLED'],
    description: '按账号状态筛选',
  })
  @IsOptional()
  @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';
}

export class ReviewSubmissionDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';

  @ApiProperty({
    description: '核验依据，例如联系对象、核验渠道、时间和可追溯编号',
    example: '2026-10-25 14:05 商户陈经理在企业微信确认，回执号 M-1025-02',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  verificationBasis!: string;

  @ApiPropertyOptional({ description: '数据提供方是否已确认本次核验结果' })
  @IsOptional()
  @IsBoolean()
  counterpartyConfirmed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AdjustWalletDto {
  @ApiProperty({ description: '请求 UUID，用于防止重复调账' })
  @IsUUID()
  requestId!: string;

  @ApiProperty({ example: '10000', description: '正数增加，负数扣减，单位分' })
  @Matches(/^-?\d+$/, money)
  amountCents!: string;

  @ApiProperty({ example: '录入线下演示充值' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class ReviewWithdrawalDto {
  @ApiProperty({ enum: ['PAID', 'REJECTED'] })
  @IsIn(['PAID', 'REJECTED'])
  decision!: 'PAID' | 'REJECTED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
