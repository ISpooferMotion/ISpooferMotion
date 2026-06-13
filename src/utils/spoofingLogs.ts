const MAX_SPOOFING_LOG_CHARS = 512_000;

export function appendSpoofingLog(prev: string, chunk: string): string {
  const next = prev + chunk;
  if (next.length <= MAX_SPOOFING_LOG_CHARS) return next;
  const overflow = next.length - MAX_SPOOFING_LOG_CHARS;
  const cutAt = next.indexOf('\n', overflow);
  return cutAt === -1 ? next.slice(-MAX_SPOOFING_LOG_CHARS) : next.slice(cutAt + 1);
}
