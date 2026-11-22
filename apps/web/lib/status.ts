export type FeedStatus = 'live' | 'stale' | 'no-data';

/** No new reading for this long means the feed is considered stale. */
export const STALE_AFTER_MS = 10_000;

/**
 * Is the data feed healthy? `latestTs` is the ISO timestamp of the newest reading,
 * `now` is epoch ms (injected so this stays pure and testable).
 */
export function feedStatus(
  latestTs: string | null | undefined,
  now: number,
  staleAfterMs: number = STALE_AFTER_MS,
): FeedStatus {
  if (!latestTs) return 'no-data';
  const ts = Date.parse(latestTs);
  if (Number.isNaN(ts)) return 'stale';
  return now - ts > staleAfterMs ? 'stale' : 'live';
}
