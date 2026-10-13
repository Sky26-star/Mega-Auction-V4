
'use client';

import { useAuth } from '@clerk/nextjs';
import { setClerkTokenGetter } from '@/lib/supabase/client';

export default function ClerkSupabaseTokenBridge() {
    const { isLoaded, isSignedIn, getToken } = useAuth();

    // Register synchronously so room actions don't run before the
    // token provider has been registered by useEffect.
    setClerkTokenGetter(async () => {
        if (!isLoaded || !isSignedIn) {
            return null;
        }

        const token = await getToken({ template: 'supabase' });

        if (!token) {
            throw new Error(
                'Clerk returned no Supabase JWT. Check the Clerk "supabase" JWT template.'
            );
        }

        return token;
    });

    return null;
}

