import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SubmitProofDto {
  @ApiProperty({ example: '已在指定信息点完成展示，现场照片见凭证链接。' })
  @IsString()
  @MinLength(5)
  @MaxLength(2_000)
  proofText!: string;

  @ApiPropertyOptional({ example: 'https://example.com/proof-image' })
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  proofUrl?: string;
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
