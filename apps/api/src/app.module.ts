import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { AuthModule } from './auth/auth.module';
import { FundsService } from './business/funds.service';
import { JwtAuthGuard, RolesGuard } from './common/guards';
import { HealthController } from './health.controller';
import { MeController } from './me.controller';
import { AuditRetentionService } from './operations/audit-retention.service';
import { OperationsModule } from './operations/operations.module';
import { PrismaModule } from './prisma/prisma.module';
import { PromoterController } from './promoter/promoter.controller';
import { PromoterService } from './promoter/promoter.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    OperationsModule,
    AuthModule,
  ],
  controllers: [HealthController, MeController, AdminController, PromoterController],
  providers: [
    AdminService,
    PromoterService,
    FundsService,
    AuditRetentionService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
