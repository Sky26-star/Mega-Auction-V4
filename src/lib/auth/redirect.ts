// Social sign-in always validates the existing profile before entering the app.
export function safeAuthRedirect(_next: string | null) {
  return '/auth/complete';
}
