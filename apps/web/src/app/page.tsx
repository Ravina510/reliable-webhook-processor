'use client';

import React, { useCallback, useEffect, useState } from 'react';

interface AttemptRecord {
  id: number;
  attempt_number: number;
  worker_id: string;
  started_at: string;
  finished_at: string | null;
  result: 'SUCCESS' | 'FAILED' | null;
  error: string | null;
}

interface WebhookEventRow {
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  attempts: number;
  max_attempts: number;
  next_run_at: string;
  locked_by: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  created_at: string;
  processed_order_id: string | null;
  attempts_history: AttemptRecord[];
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function OperationsPage() {
  const [events, setEvents] = useState<WebhookEventRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/events?limit=200`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setEvents(data.events ?? []);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
    }
  }, []);

  useEffect(() => {
    loadEvents();
    const timer = setInterval(loadEvents, 1500);
    return () => clearInterval(timer);
  }, [loadEvents]);

  const handleRetry = async (eventId: string) => {
    setRetryingId(eventId);
    try {
      const res = await fetch(`${API_BASE}/events/${encodeURIComponent(eventId)}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Retry failed (${res.status})`);
      }
      await loadEvents();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetryingId(null);
    }
  };

  const filtered =
    statusFilter === 'ALL'
      ? events
      : events.filter((e) => e.status === statusFilter);

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '24px', maxWidth: '1280px', margin: '0 auto' }}>
      <h1>Webhook Processor Operations</h1>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
        <label htmlFor="status-filter">Status:</label>
        <select
          id="status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="ALL">ALL ({events.length})</option>
          <option value="PENDING">PENDING</option>
          <option value="PROCESSING">PROCESSING</option>
          <option value="COMPLETED">COMPLETED</option>
          <option value="FAILED">FAILED</option>
        </select>
        <button onClick={loadEvents}>Refresh</button>
      </div>

      {error && (
        <p style={{ color: 'crimson' }}>Error: {error}</p>
      )}

      <table border={1} cellPadding={8} cellSpacing={0} style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>Event ID</th>
            <th>Type</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Order ID</th>
            <th>Last Error</th>
            <th>Attempt History</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((ev) => (
            <tr key={ev.event_id}>
              <td><code>{ev.event_id}</code></td>
              <td>{ev.event_type}</td>
              <td><strong>{ev.status}</strong>{ev.locked_by ? ` (${ev.locked_by})` : ''}</td>
              <td>{ev.attempts} / {ev.max_attempts}</td>
              <td>{ev.processed_order_id ?? '-'}</td>
              <td>{ev.last_error ?? '-'}</td>
              <td>
                {ev.attempts_history?.length ? (
                  <ul style={{ margin: 0, paddingLeft: '16px' }}>
                    {ev.attempts_history.map((a) => (
                      <li key={a.id}>
                        #{a.attempt_number} [{a.worker_id}] — {a.result ?? 'IN_PROGRESS'}
                        {a.error ? `: ${a.error}` : ''}
                      </li>
                    ))}
                  </ul>
                ) : (
                  '-'
                )}
              </td>
              <td>
                {ev.status === 'FAILED' ? (
                  <button
                    disabled={retryingId === ev.event_id}
                    onClick={() => handleRetry(ev.event_id)}
                  >
                    {retryingId === ev.event_id ? 'Retrying...' : 'Manual Retry'}
                  </button>
                ) : (
                  '-'
                )}
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={8}>No events found.</td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
