import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Equals,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SubmitProofDto {
  @ApiProperty({ example: '已在指定信息点完成展示，现场照片见凭证链接。' })
  @IsString()
  @MinLength(5)
  @MaxLength(2_000)
  @Matches(/\S/, { message: '凭证说明不能为空' })
  proofText!: string;

  @ApiPropertyOptional({ example: 'https://example.com/proof-image' })
  @IsOptional()
  @IsString()
  @IsUrl(
    {
      protocols: ['http', 'https'],
      require_protocol: true,
      require_tld: true,
      disallow_auth: true,
    },
    { message: '凭证链接必须是有效的 http 或 https 公网地址' },
  )
  @MaxLength(2_000)
  proofUrl?: string;

  @ApiProperty({ description: '提交人确认任务由本人真实完成，凭证可核验' })
  @Equals(true, { message: '提交前必须确认推广凭证真实有效' })
  authenticityConfirmed!: boolean;
}

export class CreateWithdrawalDto {
  @ApiProperty({ description: '提现金额，字符串整数分', example: '50000' })
  @Matches(/^\d+$/, { message: '提现金额必须是整数分' })
  amountCents!: string;

  @ApiProperty({ example: '支付宝：收款人姓名（仅作为演示说明）' })
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  payoutAccount!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
