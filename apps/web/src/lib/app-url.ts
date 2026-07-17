export function getAppUrl(): string {
  // Client: always use the actual browser origin (avoids stale localhost Site URL issues)
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  // Server: prefer explicit public URL for post-auth redirects
  const fromEnv =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_BASE_URL;

  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }

  return 'http://localhost:3000';
}
