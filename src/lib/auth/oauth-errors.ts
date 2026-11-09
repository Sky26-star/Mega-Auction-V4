const messages: Record<string, string> = {
  oauth_cancelled: 'Sign-in was cancelled. Choose Google or GitHub to try again.',
  invalid_callback: 'This sign-in link is invalid or expired. Please start again.',
  oauth_failed: 'The provider could not complete sign-in. Please try again.',
  oauth_unavailable: 'The sign-in service is unavailable. Please try again.',
};

export function oauthErrorMessage(code: string | null) {
  return code && Object.hasOwn(messages, code) ? messages[code]! : '';
}
