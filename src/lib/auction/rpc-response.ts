type RpcErrorLike = { message?: unknown } | string | null | undefined;

/** Return a visible failure unless an auction RPC explicitly confirms success. */
export function getAuctionRpcFailure(
  data: unknown,
  transportError: RpcErrorLike,
  fallback: string
): string | null {
  if (transportError) {
    if (typeof transportError === 'string' && transportError.trim()) return transportError;
    if (
      typeof transportError === 'object' &&
      typeof transportError.message === 'string' &&
      transportError.message.trim()
    ) {
      return transportError.message;
    }
    return fallback;
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) return fallback;

  const result = data as { success?: unknown; error?: unknown };
  if (result.success === true) return null;
  if (typeof result.error === 'string' && result.error.trim()) return result.error;
  return fallback;
}
