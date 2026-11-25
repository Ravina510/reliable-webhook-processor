import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { IngestWebhookDto } from './dto/ingest-webhook.dto';
import { WebhooksService } from './webhooks.service';

@Controller()
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('webhooks')
  @HttpCode(202)
  ingest(@Body() dto: IngestWebhookDto) {
    return this.webhooksService.ingest(dto);
  }

  @Get('events')
  listEvents(@Query('limit') limit?: string) {
    return this.webhooksService.listEvents(Number(limit || 200));
  }

  @Post('events/:eventId/retry')
  @HttpCode(202)
  manualRetry(
    @Param('eventId') eventId: string,
    @Body() body?: { retryBudget?: number },
  ) {
    return this.webhooksService.manualRetry(eventId, body?.retryBudget);
  }

  @Get('stats/processed-orders')
  async processedOrdersStats() {
    const count = await this.webhooksService.getProcessedOrdersCount();
    return { processedOrdersCount: count };
  }
}
