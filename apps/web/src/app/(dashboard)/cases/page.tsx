import Link from 'next/link';
import { Briefcase, Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default async function CasesPage() {
  const supabase = await createClient();

  const { data: cases } = await supabase
    .from('cases')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Cases</h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage your law firm cases and AI outbound calls.
          </p>
        </div>
      </div>

      {!cases || cases.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Briefcase className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-slate-700">No cases found</h3>
            <p className="text-sm text-slate-500 mt-1">
              Cases will appear here once they are created in the system.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cases.map((c) => (
            <Link key={c.id} href={`/cases/${c.id}`}>
              <Card className="hover:shadow-md hover:border-slate-300 transition-all cursor-pointer h-full">
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-slate-900 line-clamp-1">
                      {c.title ?? `Case ${c.id.slice(0, 8)}`}
                    </h3>
                    <Badge>{c.status ?? 'Active'}</Badge>
                  </div>
                  <p className="text-sm text-slate-500 line-clamp-2">
                    {c.case_type ?? 'General'} &middot; {c.client_name ?? 'Unknown client'}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
