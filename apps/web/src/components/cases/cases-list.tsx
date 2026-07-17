'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Briefcase, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export interface CaseListItem {
  id: string;
  name: string | null;
  case_number: string | null;
  client_name: string | null;
  case_type: string | null;
  status: string | null;
}

interface CasesListProps {
  cases: CaseListItem[];
}

function caseDisplayTitle(c: CaseListItem): string {
  if (c.case_number?.trim()) return c.case_number.trim();
  if (c.name?.trim()) return c.name.trim();
  return 'Untitled case';
}

function matchesQuery(c: CaseListItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const haystack = [
    c.case_number,
    c.name,
    c.client_name,
    c.case_type,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(q);
}

export function CasesList({ cases }: CasesListProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () => cases.filter((c) => matchesQuery(c, query)),
    [cases, query],
  );

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by case number or client name..."
          className="flex h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-firm-accent focus:border-transparent"
          aria-label="Search cases"
        />
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Briefcase className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-slate-700">
              {query.trim() ? 'No matching cases' : 'No cases found'}
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              {query.trim()
                ? 'Try a different case number or client name.'
                : 'Cases will appear here once they are created in the system.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Link key={c.id} href={`/cases/${c.id}`}>
              <Card className="hover:shadow-md hover:border-slate-300 transition-all cursor-pointer h-full">
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <h3 className="font-semibold text-slate-900 line-clamp-1">
                      {caseDisplayTitle(c)}
                    </h3>
                    <Badge>{c.status ?? 'active'}</Badge>
                  </div>
                  <p className="text-sm text-slate-500 line-clamp-2">
                    {c.case_type ?? 'General'} &middot;{' '}
                    {c.client_name ?? 'Unknown client'}
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
