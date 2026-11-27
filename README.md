Reliable Webhook Processor

A webhook ingestion and reliable background worker system built with TypeScript, NestJS, Next.js, and PostgreSQL.

Architecture

API (apps/api — NestJS): Exposes POST /webhooks to persist incoming webhook events in webhook_events (ON CONFLICT (event_id) DO NOTHING) and returns 202 Accepted for both new and duplicate deliveries. Also provides endpoints to inspect events/attempts and trigger manual retries on FAILED events.

Database (PostgreSQL): Stores webhook_events (status, lease ownership, lease expiration, retry backoff, attempts, max attempts), processed_orders (enforcing UNIQUE (event_id) for idempotent business writes), and webhook_attempts (per-attempt audit log).

Workers (apps/worker — 2+ containers): Poll due PENDING rows and lease-expired PROCESSING rows using FOR UPDATE SKIP LOCKED, renew leases during long-running work, verify lease ownership before committing state changes, and handle retries/backoff or permanent failure.

Frontend (apps/web — Next.js): Operations dashboard displaying ingested events, current status, attempt counts, attempt history, error messages, and manual retry actions.

Quick Start

From the project root, copy .env.example to .env if needed (default Compose environment variables work out of the box).

Start PostgreSQL, the API, Next.js, and at least two worker containers with one command:

docker compose up --build


Demonstration Scenarios

Adjust the API port below (for example, 3000 or 3001) to match your docker-compose.yml mapping.

1. Duplicate Event (including concurrent requests)

for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/webhooks \
    -H "Content-Type: application/json" \
    -d '{"eventId":"evt_dup_1","type":"order.created","data":{"orderId":"ORD-DUP-1","customerId":"CUS-1","simulate":"ok"}}' &
done
wait


Verify POST /webhooks returns 202 on every request and processed_orders contains only one row for evt_dup_1.

2. Temporary Failure (fail_then_succeed:N)

curl -X POST http://localhost:3000/webhooks \
  -H "Content-Type: application/json" \
  -d '{"eventId":"evt_temp_1","type":"order.created","data":{"orderId":"ORD-TEMP-1","customerId":"CUS-2","simulate":"fail_then_succeed:2"}}'


The event fails on attempts 1 and 2 with backoff, then succeeds on attempt 3 and inserts one row into processed_orders.

3. Permanent Failure (always_fail)

curl -X POST http://localhost:3000/webhooks \
  -H "Content-Type: application/json" \
  -d '{"eventId":"evt_perm_1","type":"order.created","data":{"orderId":"ORD-PERM-1","customerId":"CUS-3","simulate":"always_fail"}}'


Retries run with backoff up to max_attempts, then the event transitions to FAILED with no further automatic retries.

4. Parallel Processing (slow:N)

for n in 1 2 3 4; do
  curl -X POST http://localhost:3000/webhooks \
    -H "Content-Type: application/json" \
    -d "{\"eventId\":\"evt_slow_${n}\",\"type\":\"order.created\",\"data\":{\"orderId\":\"ORD-SLOW-${n}\",\"customerId\":\"CUS-4\",\"simulate\":\"slow:4\"}}" &
done
wait


With multiple worker containers running, independent slow events are claimed and processed concurrently across workers.

5. Worker Crash Recovery (docker kill)

curl -X POST http://localhost:3000/webhooks \
  -H "Content-Type: application/json" \
  -d '{"eventId":"evt_crash_1","type":"order.created","data":{"orderId":"ORD-CRASH-1","customerId":"CUS-5","simulate":"slow:12"}}'


Find the active worker container with docker ps, kill it with docker kill <worker_container_name>, and wait for its lease to expire. Another worker reclaims the PROCESSING event and completes it with a single processed_orders row.

6. Burst (500 Events)

for i in $(seq 1 500); do
  curl -s -o /dev/null -X POST http://localhost:3000/webhooks \
    -H "Content-Type: application/json" \
    -d "{\"eventId\":\"evt_burst_${i}\",\"type\":\"order.created\",\"data\":{\"orderId\":\"ORD-BURST-${i}\",\"customerId\":\"CUS-500\",\"simulate\":\"ok\"}}" &
  if (( i % 50 == 0 )); then wait; fi
done
wait


The API stays responsive and all 500 events reach a terminal state (COMPLETED or FAILED).

Libraries

TypeScript, NestJS, Next.js: Required application stack across API, background workers, and frontend.

pg (PostgreSQL client): Provides connection pooling, explicit transactions, FOR UPDATE SKIP LOCKED row claiming, and parameterized SQL queries without extra abstraction overhead.

Correctness Guarantees

Idempotent ingestion: webhook_events.event_id is the primary key and POST /webhooks uses ON CONFLICT (event_id) DO NOTHING, keeping the first persisted payload and ignoring later duplicates while returning 202 Accepted.

Single business action: processed_orders.event_id has a UNIQUE constraint and is inserted idempotently (ON CONFLICT (event_id) DO NOTHING), so duplicate deliveries, retries, or post-write crashes never produce duplicate rows.

Mutual exclusion: Workers claim jobs inside a transaction using FOR UPDATE SKIP LOCKED, preventing two workers from claiming the same row at the same time.

Crash recovery & lease fencing: Crashed workers leave lease_expires_at in the past so another worker can reclaim the row; lease renewal and completion/retry updates check locked_by and status = 'PROCESSING' to avoid stale-worker overwrites.

Known Limitations

If a worker stalls long enough for its lease to expire and another worker reclaims the event, a slow worker already inside an in-flight step could perform duplicate simulation work before hitting the lease/fencing check.

Local Compose runs a single PostgreSQL instance, which is a single point of failure if the database container goes down.

Decisions

PostgreSQL-backed queue/locking instead of Redis: Keeps event persistence, lease state, attempt history, and processed_orders in one transactional database.

Monotonic attempts on manual retry: Manual retry increases max_attempts and resets status to PENDING without resetting attempts, preserving accurate historical attempt numbers.

What I'd Do Next

Add a monotonic fencing token (lease_epoch) checked on every lease renewal, state transition, and processed_orders write.

Expand automated integration tests to exercise concurrent duplicate ingestion, retry exhaustion, manual retry, and container crash recovery end-to-end.

Add structured JSON logging, health/queue-depth metrics, and status filters on the operations page.