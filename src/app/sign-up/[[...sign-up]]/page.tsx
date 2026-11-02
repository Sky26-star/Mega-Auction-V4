import { AuthForm } from '@/components/auth/auth-form';
import { Navbar } from '@/components/layout/navbar';

export default function SignUpPage() {
  return <div className="min-h-screen bg-[#0B0F0D] text-[#F3F4F1]"><Navbar /><main className="mx-auto flex max-w-7xl justify-center px-4 py-10"><AuthForm initialMode="signup" /></main></div>;
}
