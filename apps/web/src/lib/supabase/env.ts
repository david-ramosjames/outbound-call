/**
 * Supabase is retiring the JWT-based anon / service_role keys by end of 2026.
 * Prefer the publishable (sb_publishable_…) and secret (sb_secret_…) keys; the
 * legacy env names remain as temporary fallbacks so Railway can be cut over
 * one variable at a time.
 */
export function supabaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
}

/** Browser / user-scoped client key (RLS applies). */
export function supabasePublishableKey(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    ''
  );
}

/** Backend-only key (bypasses RLS). Not used by the browser clients. */
export function supabaseSecretKey(): string {
  return process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';
}
