import { redirect } from 'next/navigation';

/** Compatibility URL. Supabase Auth authentication is served only from /sign-in. */
export default function LoginPage() {
  redirect('/sign-in');
}
