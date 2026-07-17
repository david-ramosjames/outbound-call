import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAppUrl } from '@/lib/app-url';
import { isAllowedEmail } from '@/lib/auth/allowed-email-domain';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/cases';
  const appUrl = getAppUrl();

  if (!code) {
    return NextResponse.redirect(`${appUrl}/login?error=auth_failed`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${appUrl}/login?error=auth_failed`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!isAllowedEmail(user?.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${appUrl}/login?error=unauthorized_domain`);
  }

  return NextResponse.redirect(`${appUrl}${next}`);
}
