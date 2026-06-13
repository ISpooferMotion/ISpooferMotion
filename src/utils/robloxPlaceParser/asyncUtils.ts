import type { ParseProgressCallback } from './types';

export async function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function createProgressReporter(
  onProgress?: ParseProgressCallback,
  throttleMs: number = 100,
) {
  if (!onProgress) {
    return () => {};
  }

  const startTime = Date.now();
  let lastReportTime = 0;

  return (phase: string, current: number, total: number, force: boolean = false) => {
    const now = Date.now();

    if (!force && now - lastReportTime < throttleMs) {
      return;
    }

    lastReportTime = now;
    let etaString: string | undefined;

    if (current > 0 && total > 0 && current < total) {
      const elapsedMs = now - startTime;
      const progressRatio = current / total;

      if (elapsedMs > 500) {
        const totalEstimatedMs = elapsedMs / progressRatio;
        const remainingMs = totalEstimatedMs - elapsedMs;

        if (remainingMs > 1000) {
          const remainingSecs = Math.round(remainingMs / 1000);
          if (remainingSecs > 60) {
            const mins = Math.floor(remainingSecs / 60);
            const secs = remainingSecs % 60;
            etaString = `${mins}m ${secs}s`;
          } else {
            etaString = `${remainingSecs}s`;
          }
        } else {
          etaString = '< 1s';
        }
      }
    }

    onProgress({
      phase,
      current,
      total,
      eta: etaString,
    });
  };
}
