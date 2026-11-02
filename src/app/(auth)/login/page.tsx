import { redirect } from 'next/navigation';

/** Compatibility URL. Clerk authentication is served only from /sign-in. */
export default function LoginPage() {
  redirect('/sign-in');
}
