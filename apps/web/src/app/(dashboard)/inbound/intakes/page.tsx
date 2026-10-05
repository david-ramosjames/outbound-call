import Link from 'next/link';
import { Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { InboundPageHeader } from '@/components/inbound/page-header';
import { IntakesTable, type IntakeRow } from '@/components/inbound/intakes-table';
import { loadLineNames } from '@/lib/inbound-line-names';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'high_priority', label: 'High Priority' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'needs_review', label: 'Needs Review' },
  { id: 'contract_sent', label: 'Contract Sent' },
  { id: 'signed', label: 'Signed' },
  { id: 'transferred', label: 'Transferred' },
  { id: 'incomplete', label: 'Incomplete' },
] as const;

export default async function InboundIntakesPage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string }> }) {
  const { filter = 'all', q } = await searchParams;
  const search = (q ?? '').replace(/[,()%*\\]/g, ' ').trim();
  const supabase = await createClient();
  const lineNames = await loadLineNames(supabase);

  let query = supabase
    .from('inbound_intakes')
    .select(
      `id, call_id, status, caller_name, phone, language, case_type, qualification_result, high_priority, contract_status, created_at${lineNames ? ', line_id' : ''}`,
    )
    .order('created_at', { ascending: false })
    .limit(200);

  switch (filter) {
    case 'high_priority':
      query = query.or('high_priority.eq.true,qualification_result.eq.high_priority');
      break;
    case 'qualified':
      query = query.in('qualification_result', ['qualified', 'high_priority']);
      break;
    case 'needs_review':
      query = query.eq('status', 'needs_review');
      break;
    case 'contract_sent':
      query = query.eq('contract_status', 'sent');
      break;
    case 'signed':
      query = query.eq('contract_status', 'signed');
      break;
    case 'transferred':
      query = query.eq('status', 'transferred');
      break;
    case 'incomplete':
      query = query.eq('status', 'incomplete');
      break;
  }
  if (search) query = query.or(`caller_name.ilike.*${search}*,phone.ilike.*${search}*`);

  const { data, error } = await query;

  return (
    <div className="space-y-6">
      <InboundPageHeader title="Intakes" description="Every intake record created by the AI, newest first." />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.id}
            href={`/inbound/intakes?filter=${f.id}${search ? `&q=${encodeURIComponent(search)}` : ''}`}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              filter === f.id ? 'border-navy-700 bg-navy-800 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <form method="get" className="flex items-center gap-2">
            <input type="hidden" name="filter" value={filter} />
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                name="q"
                defaultValue={q ?? ''}
                placeholder="Search caller name or phone"
                className="h-9 w-72 rounded-md border border-slate-300 bg-white pl-8 pr-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-firm-accent"
              />
            </div>
            <Button type="submit" size="sm">
              Search
            </Button>
          </form>
        </CardHeader>
        {error ? (
          <p className="px-6 py-8 text-sm text-red-600">Could not load intakes: {error.message}</p>
        ) : (
          <IntakesTable rows={(data ?? []) as unknown as IntakeRow[]} lineNames={lineNames} />
        )}
      </Card>
    </div>
  );
}
