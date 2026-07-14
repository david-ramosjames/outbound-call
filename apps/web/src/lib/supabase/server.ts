import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

interface CookieToSet {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }: CookieToSet) =>
              cookieStore.set(name, value, options as any),
            );
          } catch {
            // setAll can be called from a Server Component where cookies
            // cannot be set. This is safe to ignore when the middleware
            // is refreshing the session.
          }
        },
      },
    },
  );
}
