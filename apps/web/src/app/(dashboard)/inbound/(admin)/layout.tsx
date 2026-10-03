import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isInboundAdmin } from '@/lib/inbound-admin';

export const dynamic = 'force-dynamic';

export default async function InboundAdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  if (!(await isInboundAdmin(supabase))) redirect('/inbound');
  return <>{children}</>;
}
