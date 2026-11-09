const STALE_COUNTER_PARENT_ERRORS = new Set([
  'ERR_PARENT_TRADE_NOT_FOUND',
  'ERR_PARENT_TRADE_MISMATCH',
  'ERR_PARENT_TRADE_NOT_PENDING',
  'ERR_PARENT_TRADE_EXPIRED',
  'ERR_COUNTER_TEAM_NOT_RECEIVER',
  'ERR_COUNTER_TARGET_MISMATCH',
]);

/** Identifies authoritative RPC rejections that make the current counter-offer context invalid. */
export function isStaleCounterParentError(error: string | undefined): boolean {
  return Boolean(error && STALE_COUNTER_PARENT_ERRORS.has(error.trim()));
}
