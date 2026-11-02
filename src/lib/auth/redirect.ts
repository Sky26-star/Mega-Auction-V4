// Limit auth callbacks to known application destinations, including recovery.
export function safeAuthRedirect(next: string | null) {
  return next === '/reset-password' ? next : '/auth/complete';
}
