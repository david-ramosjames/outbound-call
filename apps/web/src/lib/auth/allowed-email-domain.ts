export const ALLOWED_EMAIL_DOMAIN = 'ramosjames.com';

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;

  const atIndex = email.lastIndexOf('@');
  if (atIndex === -1) return false;

  const domain = email.slice(atIndex + 1).toLowerCase();
  return domain === ALLOWED_EMAIL_DOMAIN.toLowerCase();
}

export const UNAUTHORIZED_DOMAIN_MESSAGE =
  'Only @ramosjames.com Google accounts are allowed to sign in.';
