export type TickActionStatus = 'succeeded' | 'failed' | 'skipped';

export interface TickAction {
  action: string;
  status: TickActionStatus;
  [key: string]: unknown;
}

export interface TickResult {
  schemaVersion: 1;
  success: boolean;
  failureCount: number;
  actions: TickAction[];
  message?: string;
}

export function tickResult(actions: TickAction[], message?: string): TickResult {
  const failureCount = actions.filter(action => action.status === 'failed').length;
  return { schemaVersion: 1, success: failureCount === 0, failureCount, actions, ...(message ? { message } : {}) };
}

// Only authoritative race/expiry guards are harmless skips. Other rejections
// (including authorization and database failures) must not be called healthy.
export function tickRejectionStatus(error: unknown): TickActionStatus {
  return [
    'ERR_CONCURRENT_AUCTION_FINALIZATION_IN_PROGRESS',
    'ERR_LOT_NOT_BIDDING', 'ERR_TIMER_NOT_EXPIRED', 'ERR_LOT_NOT_GET_READY',
  ].includes(String(error)) ? 'skipped' : 'failed';
}

/** Reject login HTML, old response contracts, and contradictory success flags. */
export function isTickResult(value: unknown): value is TickResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as TickResult;
  if (result.schemaVersion !== 1 || !Number.isSafeInteger(result.failureCount)
    || result.failureCount < 0 || !Array.isArray(result.actions)) return false;
  if (!result.actions.every(action => action && typeof action === 'object'
    && typeof action.action === 'string'
    && ['succeeded', 'failed', 'skipped'].includes(action.status))) return false;
  const failures = result.actions.filter(action => action.status === 'failed').length;
  return result.failureCount === failures && result.success === (failures === 0);
}
