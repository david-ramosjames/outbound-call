import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { DashboardSidebar } from '@/components/layout/sidebar';
import { isInboundAdmin } from '@/lib/inbound-admin';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const isAdmin = await isInboundAdmin(supabase);

  return (
    <div className="flex min-h-screen">
      <DashboardSidebar userEmail={user.email ?? ''} isAdmin={isAdmin} />
      <main className="flex-1 ml-[var(--sidebar-width)]">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
