'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Briefcase,
  Phone,
  Settings,
  Scale,
  LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';

const navItems = [
  { label: 'Cases', href: '/cases', icon: Briefcase },
  { label: 'AI Calls', href: '/calls', icon: Phone },
  { label: 'Settings', href: '/settings/voice', icon: Settings },
];

interface DashboardSidebarProps {
  userEmail: string;
}

export function DashboardSidebar({ userEmail }: DashboardSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <aside className="fixed left-0 top-0 h-screen w-[var(--sidebar-width)] border-r border-slate-200 bg-white flex flex-col">
      <div className="p-5 border-b border-slate-100">
        <Link href="/cases" className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-navy-800">
            <Scale className="h-4 w-4 text-white" />
          </div>
          <div>
            <span className="text-sm font-bold text-navy-900 block leading-tight">
              Case Tracker
            </span>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">
              AI Calling
            </span>
          </div>
        </Link>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'sidebar-nav-item',
                isActive && 'active',
              )}
            >
              <Icon className="h-4.5 w-4.5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-100">
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-700 truncate">
              {userEmail}
            </p>
          </div>
          <button
            onClick={handleSignOut}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
