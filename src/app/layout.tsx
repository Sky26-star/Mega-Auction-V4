
import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata } from 'next';
import ClerkSupabaseTokenBridge from '@/components/providers/clerk-supabase-token-bridge';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Based Career Guidance and Job Finder Website',
  description: 'AI based career guidance and job finder website',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/auth/complete"
      signUpFallbackRedirectUrl="/auth/complete"
    >
      <html lang="en" className="dark">
        <body>
          <ClerkSupabaseTokenBridge />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
