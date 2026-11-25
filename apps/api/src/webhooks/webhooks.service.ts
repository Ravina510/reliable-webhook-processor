import { Inject, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { Pool } from '@rwp/db';
import { IngestWebhookDto } from './dto/ingest-webhook.dto';

@Injectable()
export class WebhooksService implements OnModuleDestroy {
  private readonly defaultMaxAttempts: number;

  constructor(@Inject('PG_POOL') private readonly pool: Pool) {
    this.defaultMaxAttempts = Number(process.env.MAX_ATTEMPTS || 5);
  }

  async ingest(dto: IngestWebhookDto): Promise<{ accepted: boolean; eventId: string }> {
    const payload = dto.data ?? {};
    await this.pool.query(
      `
      INSERT INTO webhook_events (
        event_id,
        event_type,
        payload,
        status,
        attempts,
        max_attempts,
        next_run_at
      )
      VALUES ($1, $2, $3::jsonb, 'PENDING', 0, $4, NOW())
      ON CONFLICT (event_id) DO NOTHING
      `,
      [dto.eventId, dto.type, JSON.stringify(payload), this.defaultMaxAttempts],
    );

    return { accepted: true, eventId: dto.eventId };
  }

  async listEvents(limit = 200) {
    const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    const { rows } = await this.pool.query(
      `
      SELECT
        e.event_id,
        e.event_type,
        e.payload,
        e.status,
        e.attempts,
        e.max_attempts,
        e.next_run_at,
        e.locked_by,
        e.lease_expires_at,
        e.last_error,
        e.created_at,
        e.updated_at,
        po.order_id AS processed_order_id,
        po.processed_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', a.id,
              'attempt_number', a.attempt_number,
              'worker_id', a.worker_id,
              'started_at', a.started_at,
              'finished_at', a.finished_at,
              'result', a.result,
              'error', a.error
            )
            ORDER BY a.attempt_number DESC
          ) FILTER (WHERE a.id IS NOT NULL),
          '[]'::json
        ) AS attempts_history
      FROM webhook_events e
      LEFT JOIN processed_orders po ON po.event_id = e.event_id
      LEFT JOIN webhook_attempts a ON a.event_id = e.event_id
      GROUP BY e.event_id, po.order_id, po.processed_at
      ORDER BY e.created_at DESC
      LIMIT $1
      `,
      [safeLimit],
    );

    return { events: rows };
  }

  async manualRetry(eventId: string, extraBudget?: number) {
    const budgetToAdd =
      extraBudget && Number.isFinite(extraBudget) && extraBudget > 0
        ? Math.floor(extraBudget)
        : this.defaultMaxAttempts;

    const { rows } = await this.pool.query(
      `
      UPDATE webhook_events
      SET
        status = 'PENDING',
        max_attempts = GREATEST(max_attempts, attempts) + $2,
        next_run_at = NOW(),
        locked_by = NULL,
        lease_expires_at = NULL,
        last_error = NULL,
        updated_at = NOW()
      WHERE event_id = $1
        AND status = 'FAILED'
      RETURNING event_id, status, attempts, max_attempts, next_run_at
      `,
      [eventId, budgetToAdd],
    );

    if (rows.length === 0) {
      throw new NotFoundException(
        `Event ${eventId} not found or not in FAILED state`,
      );
    }

    return { retried: true, event: rows[0] };
  }

  async getProcessedOrdersCount(): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM processed_orders`,
    );
    return Number(rows[0]?.count ?? 0);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
