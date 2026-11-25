import { Pool } from '@rwp/db';
import { executeSimulation, parseSimulation } from './simulate';

export interface WorkerConfig {
  workerId: string;
  leaseDurationMs: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
}

interface ClaimedEventRow {
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export async function claimNextEvent(
  pool: Pool,
  workerId: string,
  leaseDurationMs: number,
): Promise<ClaimedEventRow | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<ClaimedEventRow>(
      `
      WITH next_job AS (
        SELECT event_id
        FROM webhook_events
        WHERE
          (status = 'PENDING' AND next_run_at <= NOW())
          OR
          (status = 'PROCESSING' AND lease_expires_at <= NOW())
        ORDER BY next_run_at ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE webhook_events w
      SET
        status = 'PROCESSING',
        attempts = w.attempts + 1,
        locked_by = $1,
        lease_expires_at = NOW() + ($2 * INTERVAL '1 millisecond'),
        updated_at = NOW()
      FROM next_job
      WHERE w.event_id = next_job.event_id
      RETURNING w.event_id, w.event_type, w.payload, w.attempts, w.max_attempts
      `,
      [workerId, leaseDurationMs],
    );
    await client.query('COMMIT');
    return rows[0] ?? null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function renewLease(
  pool: Pool,
  eventId: string,
  workerId: string,
  leaseDurationMs: number,
): Promise<void> {
  await pool.query(
    `
    UPDATE webhook_events
    SET lease_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
        updated_at = NOW()
    WHERE event_id = $1
      AND locked_by = $2
      AND status = 'PROCESSING'
    `,
    [eventId, workerId, leaseDurationMs],
  );
}

async function recordAttemptStart(
  pool: Pool,
  eventId: string,
  attemptNumber: number,
  workerId: string,
): Promise<void> {
  await pool.query(
    `
    INSERT INTO webhook_attempts (event_id, attempt_number, worker_id, started_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (event_id, attempt_number)
    DO UPDATE SET worker_id = EXCLUDED.worker_id, started_at = NOW(), finished_at = NULL, result = NULL, error = NULL
    `,
    [eventId, attemptNumber, workerId],
  );
}

async function recordAttemptFinish(
  pool: Pool,
  eventId: string,
  attemptNumber: number,
  result: 'SUCCESS' | 'FAILED',
  errorMessage: string | null,
): Promise<void> {
  await pool.query(
    `
    UPDATE webhook_attempts
    SET finished_at = NOW(),
        result = $3::attempt_result,
        error = $4
    WHERE event_id = $1 AND attempt_number = $2
    `,
    [eventId, attemptNumber, result, errorMessage],
  );
}

function computeBackoffMs(
  attemptNumber: number,
  baseBackoffMs: number,
  maxBackoffMs: number,
): number {
  const exp = baseBackoffMs * Math.pow(2, Math.max(0, attemptNumber - 1));
  const jitter = Math.floor(Math.random() * Math.min(250, baseBackoffMs));
  return Math.min(maxBackoffMs, exp + jitter);
}

export async function processOnce(pool: Pool, cfg: WorkerConfig): Promise<boolean> {
  const job = await claimNextEvent(pool, cfg.workerId, cfg.leaseDurationMs);
  if (!job) {
    return false;
  }

  const attemptNumber = job.attempts;
  await recordAttemptStart(pool, job.event_id, attemptNumber, cfg.workerId);

  const sim = parseSimulation(job.payload?.simulate);
  const orderId =
    typeof job.payload?.orderId === 'string' && job.payload.orderId.trim()
      ? job.payload.orderId.trim()
      : `ORDER-${job.event_id}`;

  try {
    let lastHeartbeat = Date.now();
    await executeSimulation(sim, attemptNumber, async () => {
      if (Date.now() - lastHeartbeat >= Math.max(250, Math.floor(cfg.leaseDurationMs / 3))) {
        lastHeartbeat = Date.now();
        await renewLease(pool, job.event_id, cfg.workerId, cfg.leaseDurationMs);
      }
    });

    await pool.query(
      `
      INSERT INTO processed_orders (order_id, event_id, processed_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (event_id) DO NOTHING
      `,
      [orderId, job.event_id],
    );

    await pool.query(
      `
      UPDATE webhook_events
      SET status = 'COMPLETED',
          locked_by = NULL,
          lease_expires_at = NULL,
          last_error = NULL,
          updated_at = NOW()
      WHERE event_id = $1
      `,
      [job.event_id],
    );

    await recordAttemptFinish(pool, job.event_id, attemptNumber, 'SUCCESS', null);
    console.log(`[${cfg.workerId}] COMPLETED ${job.event_id} (attempt ${attemptNumber})`);
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const exhausted = attemptNumber >= job.max_attempts;

    if (exhausted) {
      await pool.query(
        `
        UPDATE webhook_events
        SET status = 'FAILED',
            locked_by = NULL,
            lease_expires_at = NULL,
            last_error = $2,
            updated_at = NOW()
        WHERE event_id = $1
        `,
        [job.event_id, message],
      );
      console.warn(`[${cfg.workerId}] FAILED permanently ${job.event_id} (attempt ${attemptNumber}/${job.max_attempts}): ${message}`);
    } else {
      const delayMs = computeBackoffMs(attemptNumber, cfg.baseBackoffMs, cfg.maxBackoffMs);
      await pool.query(
        `
        UPDATE webhook_events
        SET status = 'PENDING',
            next_run_at = NOW() + ($2 * INTERVAL '1 millisecond'),
            locked_by = NULL,
            lease_expires_at = NULL,
            last_error = $3,
            updated_at = NOW()
        WHERE event_id = $1
        `,
        [job.event_id, delayMs, message],
      );
      console.log(`[${cfg.workerId}] RETRY scheduled for ${job.event_id} in ${delayMs}ms (attempt ${attemptNumber}/${job.max_attempts}): ${message}`);
    }

    await recordAttemptFinish(pool, job.event_id, attemptNumber, 'FAILED', message);
    return true;
  }
}
