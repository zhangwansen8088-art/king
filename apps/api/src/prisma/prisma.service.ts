import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import { createDatabaseAdapter } from './database-adapter';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: createDatabaseAdapter() });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async serializable<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    onConflictExhausted: () => Error = () =>
      new ServiceUnavailableException('系统繁忙，请稍后重试'),
  ): Promise<T> {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 15_000,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 40));
            continue;
          }
          throw onConflictExhausted();
        }
        throw error;
      }
    }
    throw onConflictExhausted();
  }
}
