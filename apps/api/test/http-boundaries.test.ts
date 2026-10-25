import 'reflect-metadata';
import { ValidationPipe, type CanActivate, type ExecutionContext, type Type } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { JwtAuthGuard, RolesGuard } from '../src/common/guards';
import { ROLES_KEY } from '../src/common/decorators';
import { AdminController } from '../src/admin/admin.controller';
import { CreateMerchantDto } from '../src/admin/admin.dto';
import { AuthController } from '../src/auth/auth.controller';
import { LoginDto } from '../src/auth/auth.dto';
import { PromoterController } from '../src/promoter/promoter.controller';
import { CreateWithdrawalDto } from '../src/promoter/promoter.dto';
import express, { type Request, type Response } from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reflector = new Reflector();
const validationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

type Handler = (request: Request, response: Response) => Promise<unknown>;

function executionContext(request: Request, handler: object, controller: object): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => undefined,
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

function routeWithGuards(
  app: express.Express,
  method: 'post' | 'get',
  path: string,
  handler: object,
  controller: object,
  callback: Handler,
  guards: CanActivate[],
  bodyType?: Type<unknown>,
): void {
  const route = async (request: Request, response: Response) => {
    try {
      const context = executionContext(request, handler, controller);
      for (const guard of guards) await guard.canActivate(context);
      if (bodyType)
        request.body = await validationPipe.transform(request.body, {
          type: 'body',
          metatype: bodyType,
        });
      await callback(request, response);
    } catch (error) {
      const status =
        typeof (error as { getStatus?: () => number }).getStatus === 'function'
          ? (error as { getStatus: () => number }).getStatus()
          : 500;
      response.status(status).json({ statusCode: status });
    }
  };
  app[method](path, route);
}

async function start(app: express.Express): Promise<{ server: Server; origin: string }> {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  return { server, origin: `http://127.0.0.1:${port}` };
}

async function stop(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function authGuards(role: 'ADMIN' | 'PROMOTER'): CanActivate[] {
  const jwt = { verifyAsync: vi.fn(async () => ({ sub: 'user-id', sessionId: 'session-id' })) };
  const prisma = {
    refreshSession: {
      findFirst: vi.fn(async () => ({
        user: {
          id: 'user-id',
          username: 'test',
          displayName: 'Test',
          role,
          status: 'ACTIVE',
        },
      })),
    },
  };
  return [new JwtAuthGuard(jwt as never, reflector, prisma as never), new RolesGuard(reflector)];
}

describe('HTTP 控制器边界', () => {
  let server: Server | undefined;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-only-jwt-secret-with-at-least-32-characters';
    process.env.WEB_ORIGIN = 'http://127.0.0.1:5173';
  });

  afterEach(async () => {
    if (server) await stop(server);
    server = undefined;
  });

  it('admin：无令牌返回 401', async () => {
    const controller = new AdminController({
      merchants: vi.fn(),
      createMerchant: vi.fn(),
    } as never);
    const app = express();
    routeWithGuards(
      app,
      'get',
      '/admin/dashboard',
      AdminController.prototype.dashboard,
      AdminController,
      () => Promise.resolve(controller.dashboard()),
      [
        new JwtAuthGuard({ verifyAsync: vi.fn() } as never, reflector, {} as never),
        new RolesGuard(reflector),
      ],
    );
    ({ server } = await start(app));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await expect(fetch(`${origin}/admin/dashboard`)).resolves.toHaveProperty('status', 401);
  });

  it('admin：PROMOTER 访问返回 403', async () => {
    const controller = new AdminController({
      merchants: vi.fn(),
      createMerchant: vi.fn(),
    } as never);
    const app = express();
    routeWithGuards(
      app,
      'get',
      '/admin/dashboard',
      AdminController.prototype.dashboard,
      AdminController,
      () => Promise.resolve(controller.dashboard()),
      authGuards('PROMOTER'),
    );
    ({ server } = await start(app));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await expect(
      fetch(`${origin}/admin/dashboard`, { headers: { authorization: 'Bearer test' } }),
    ).resolves.toHaveProperty('status', 403);
  });

  it('admin：坏 DTO 返回 400', async () => {
    const controller = new AdminController({
      merchants: vi.fn(),
      createMerchant: vi.fn(),
    } as never);
    const app = express();
    app.use(express.json());
    routeWithGuards(
      app,
      'post',
      '/admin/merchants',
      AdminController.prototype.createMerchant,
      AdminController,
      (request) =>
        Promise.resolve(
          controller.createMerchant(
            (request as Request & { user: unknown }).user as never,
            request.body,
          ),
        ),
      authGuards('ADMIN'),
      CreateMerchantDto,
    );
    ({ server } = await start(app));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await expect(
      fetch(`${origin}/admin/merchants`, {
        method: 'POST',
        headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
        body: JSON.stringify({ companyName: '' }),
      }),
    ).resolves.toHaveProperty('status', 400);
  });

  it('promoter：无令牌返回 401，坏提现 DTO 返回 400', async () => {
    const controller = new PromoterController({ requestWithdrawal: vi.fn() } as never);
    const app = express();
    app.use(express.json());
    routeWithGuards(
      app,
      'get',
      '/promoter/dashboard',
      PromoterController.prototype.dashboard,
      PromoterController,
      (request) =>
        Promise.resolve(
          controller.dashboard((request as Request & { user: unknown }).user as never),
        ),
      [
        new JwtAuthGuard({ verifyAsync: vi.fn() } as never, reflector, {} as never),
        new RolesGuard(reflector),
      ],
    );
    routeWithGuards(
      app,
      'post',
      '/promoter/withdrawals',
      PromoterController.prototype.withdraw,
      PromoterController,
      (request) =>
        Promise.resolve(
          controller.withdraw((request as Request & { user: unknown }).user as never, request.body),
        ),
      authGuards('PROMOTER'),
      CreateWithdrawalDto,
    );
    ({ server } = await start(app));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    await expect(fetch(`${origin}/promoter/dashboard`)).resolves.toHaveProperty('status', 401);
    await expect(
      fetch(`${origin}/promoter/withdrawals`, {
        method: 'POST',
        headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
        body: JSON.stringify({ amountCents: 'not-money' }),
      }),
    ).resolves.toHaveProperty('status', 400);
  });

  it('auth：坏登录 DTO 返回 400', async () => {
    const controller = new AuthController({ login: vi.fn() } as never);
    const app = express();
    app.use(express.json());
    routeWithGuards(
      app,
      'post',
      '/auth/login',
      AuthController.prototype.login,
      AuthController,
      (request) => Promise.resolve(controller.login(request.body, request, {} as never)),
      [],
      LoginDto,
    );
    ({ server } = await start(app));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    await expect(
      fetch(`${origin}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: '', password: '' }),
      }),
    ).resolves.toHaveProperty('status', 400);
  });

  it('auth：会话列表无令牌返回 401', async () => {
    const controller = new AuthController({ listSessions: vi.fn() } as never);
    const app = express();
    routeWithGuards(
      app,
      'get',
      '/auth/sessions',
      AuthController.prototype.sessions,
      AuthController,
      (request) =>
        Promise.resolve(
          controller.sessions((request as Request & { user: unknown }).user as never),
        ),
      [
        new JwtAuthGuard({ verifyAsync: vi.fn() } as never, reflector, {} as never),
        new RolesGuard(reflector),
      ],
    );
    ({ server } = await start(app));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await expect(fetch(`${origin}/auth/sessions`)).resolves.toHaveProperty('status', 401);
  });

  it('AppModule 注册 JwtAuthGuard 和 RolesGuard 全局守卫', () => {
    const providers = Reflect.getMetadata('providers', AppModule) as Array<unknown>;
    const globalGuards = providers.filter(
      (provider): provider is { provide: typeof APP_GUARD; useClass: Type<unknown> } =>
        typeof provider === 'object' &&
        provider !== null &&
        'provide' in provider &&
        'useClass' in provider &&
        provider.provide === APP_GUARD,
    );

    expect(globalGuards.map((provider) => provider.useClass)).toEqual([JwtAuthGuard, RolesGuard]);
  });

  it('控制器角色元数据保持 ADMIN/PROMOTER 隔离', () => {
    expect(reflector.get(ROLES_KEY, AdminController)).toEqual(['ADMIN']);
    expect(reflector.get(ROLES_KEY, PromoterController)).toEqual(['PROMOTER']);
  });
});
