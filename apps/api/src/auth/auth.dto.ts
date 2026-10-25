import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  username!: string;

  @ApiProperty({ example: '请替换为环境变量中的密码' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}
