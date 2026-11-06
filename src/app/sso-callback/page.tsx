import { redirect } from 'next/navigation';
export default function SsoCallback() { redirect('/sign-in'); }
