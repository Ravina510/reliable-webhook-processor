export type SimulationMode =
  | { kind: 'ok' }
  | { kind: 'fail_then_succeed'; failCount: number }
  | { kind: 'always_fail' }
  | { kind: 'slow'; seconds: number };

export function parseSimulation(raw: unknown): SimulationMode {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.trim() === 'ok') {
    return { kind: 'ok' };
  }

  const trimmed = raw.trim();
  if (trimmed === 'always_fail') {
    return { kind: 'always_fail' };
  }

  if (trimmed.startsWith('fail_then_succeed:')) {
    const n = Number(trimmed.split(':')[1]);
    return {
      kind: 'fail_then_succeed',
      failCount: Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0,
    };
  }

  if (trimmed.startsWith('slow:')) {
    const sec = Number(trimmed.split(':')[1]);
    return {
      kind: 'slow',
      seconds: Number.isFinite(sec) && sec >= 0 ? sec : 0,
    };
  }

  return { kind: 'ok' };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeSimulation(
  mode: SimulationMode,
  attemptNumber: number,
  onTick?: () => Promise<void>,
): Promise<void> {
  if (mode.kind === 'always_fail') {
    throw new Error(`Simulated failure on attempt ${attemptNumber} (always_fail)`);
  }

  if (mode.kind === 'fail_then_succeed') {
    if (attemptNumber <= mode.failCount) {
      throw new Error(
        `Simulated failure on attempt ${attemptNumber} (fail_then_succeed:${mode.failCount})`,
      );
    }
    return;
  }

  if (mode.kind === 'slow') {
    const totalMs = Math.round(mode.seconds * 1000);
    const stepMs = 500;
    let elapsed = 0;
    while (elapsed < totalMs) {
      const chunk = Math.min(stepMs, totalMs - elapsed);
      await sleep(chunk);
      elapsed += chunk;
      if (onTick) {
        await onTick();
      }
    }
  }
}
