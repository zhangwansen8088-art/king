import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AlertExceptionFilter } from './common/alert-exception.filter';
import { BigIntInterceptor } from './common/bigint.interceptor';
import { requestLoggingMiddleware } from './common/request-logging.middleware';
import { loadEnv } from './config/env';
import { AlertService } from './operations/alert.service';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });

  app.setGlobalPrefix('api');
  app.use(requestLoggingMiddleware);
  // 只信任显式配置的代理网段；未配置时直接使用 TCP 连接地址。
  app.set('trust proxy', env.trustProxy.length > 0 ? env.trustProxy : false);
  app.use(helmet());
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new BigIntInterceptor());
  app.useGlobalFilters(
    new AlertExceptionFilter(app.get(HttpAdapterHost).httpAdapter, app.get(AlertService)),
  );
  app.enableCors({
    origin: env.webOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID'],
  });

  if (env.enableSwagger) {
    const config = new DocumentBuilder()
      .setTitle('Max 众推台 API')
      .setDescription('推广客户工作台与管理员后台接口。商户没有独立登录入口。')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  app.enableShutdownHooks();
  await app.listen(env.port, '0.0.0.0');
}

void bootstrap();
