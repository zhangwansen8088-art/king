import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
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

export class ReviewSubmissionDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';

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
