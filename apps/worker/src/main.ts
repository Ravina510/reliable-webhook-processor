import { createPool } from '@rwp/db';
import { processOnce, WorkerConfig } from './processor';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const cfg: WorkerConfig = {
    workerId: process.env.WORKER_ID || `worker-${process.pid}`,
    leaseDurationMs: Number(process.env.LEASE_DURATION_MS || 10000),
    baseBackoffMs: Number(process.env.BASE_BACKOFF_MS || 500),
    maxBackoffMs: Number(process.env.MAX_BACKOFF_MS || 5000),
  };
  const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS || 250);
  const pool = createPool();

  let stopping = false;
  const shutdown = async () => {
    stopping = true;
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  console.log(`Worker ${cfg.workerId} started (lease=${cfg.leaseDurationMs}ms)`);

  while (!stopping) {
    try {
      const worked = await processOnce(pool, cfg);
      if (!worked) {
        await sleep(pollIntervalMs);
      }
    } catch (err) {
      console.error(`[${cfg.workerId}] Loop error:`, err);
      await sleep(pollIntervalMs);
    }
  }
}

main();
