import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { OperationsModule } from '../operations/operations.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoginThrottleService } from './login-throttle.service';

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
    OperationsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, LoginThrottleService],
  exports: [JwtModule],
})
export class AuthModule {}
