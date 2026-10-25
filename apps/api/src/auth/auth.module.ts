import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (): JwtModuleOptions => {
        const secret = process.env.JWT_SECRET;
        if (!secret) throw new Error('缺少环境变量 JWT_SECRET');
        return {
          secret,
          signOptions: {
            expiresIn: (process.env.ACCESS_TOKEN_TTL ?? '15m') as Exclude<
              NonNullable<JwtModuleOptions['signOptions']>['expiresIn'],
              undefined
            >,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [JwtModule],
})
export class AuthModule {}
