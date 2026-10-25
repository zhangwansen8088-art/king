import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from './common/decorators';
import { PrismaService } from './prisma/prisma.service';

@ApiTags('系统')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 保留旧健康检查地址，避免已有部署脚本失效。
   */
  @Public()
  @Get()
  async health(): Promise<{ status: string; database: string }> {
    return this.ready();
  }

  /**
   * 存活探针只检查进程能否响应，不依赖数据库。
   */
  @Public()
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  /**
   * 就绪探针检查数据库连接；数据库不可用时返回 503，避免继续接收流量。
   */
  @Public()
  @Get('ready')
  async ready(): Promise<{ status: string; database: string }> {
    try {
      await this.checkDatabase();
    } catch (error) {
      // 仅记录错误类型，不输出连接串、账号或密码等敏感信息。
      const errorType = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(`数据库就绪检查失败：${errorType}`);
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'unavailable',
      });
    }

    return { status: 'ok', database: 'ok' };
  }

  private async checkDatabase(): Promise<void> {
    let timeout: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('数据库健康检查超时')), 3_000);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
