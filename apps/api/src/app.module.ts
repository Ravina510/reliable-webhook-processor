import { Module } from '@nestjs/common';
import { createPool } from '@rwp/db';
import { HealthController } from './health.controller';
import { WebhooksController } from './webhooks/webhooks.controller';
import { WebhooksService } from './webhooks/webhooks.service';

@Module({
  controllers: [HealthController, WebhooksController],
  providers: [
    {
      provide: 'PG_POOL',
      useFactory: () => createPool(),
    },
    WebhooksService,
  ],
})
export class AppModule {}
