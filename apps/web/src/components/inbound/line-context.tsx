'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PhoneIncoming } from 'lucide-react';
import type { InboundLineRow } from '@outbound-call/shared';
import { createClient } from '@/lib/supabase/client';
import { selectClass } from './page-header';

const STORAGE_KEY = 'inbound.lineId';

interface LineContextValue {
  lines: InboundLineRow[];
  /** False until migration 010 has been run; pages then fall back to the single legacy settings row. */
  linesAvailable: boolean;
  loading: boolean;
  line: InboundLineRow | null;
  lineId: string | null;
  setLineId: (id: string) => void;
  reload: () => Promise<void>;
}

const LineContext = createContext<LineContextValue | null>(null);

export function InboundLineProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<InboundLineRow[]>([]);
  const [linesAvailable, setLinesAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [lineId, setLineIdState] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('inbound_lines')
      .select('id, name, slug, phone_numbers, signflow_firm_id, is_default, active')
      .order('is_default', { ascending: false })
      .order('name');
    const rows = (data ?? []) as InboundLineRow[];
    setLinesAvailable(!error);
    setLines(rows);
    setLineIdState((current) => {
      const stored = current ?? (typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null);
      if (stored && rows.some((r) => r.id === stored)) return stored;
      return rows.find((r) => r.is_default)?.id ?? rows[0]?.id ?? null;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setLineId = useCallback((id: string) => {
    setLineIdState(id);
    window.localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const value = useMemo<LineContextValue>(
    () => ({ lines, linesAvailable, loading, line: lines.find((l) => l.id === lineId) ?? null, lineId, setLineId, reload }),
    [lines, linesAvailable, loading, lineId, setLineId, reload],
  );
  return <LineContext.Provider value={value}>{children}</LineContext.Provider>;
}

export function useInboundLine(): LineContextValue {
  const ctx = useContext(LineContext);
  if (!ctx) throw new Error('useInboundLine must be used inside InboundLineProvider');
  return ctx;
}

/** Line selector for pages whose settings are per intake line. */
export function LinePicker({ hint = 'Settings on this page apply to the selected line.' }: { hint?: string }) {
  const { lines, linesAvailable, line, lineId, setLineId, loading } = useInboundLine();
  if (loading) return null;
  if (!linesAvailable) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
        Multiple intake lines are not enabled yet: run migration <code>20240101000010_inbound_lines.sql</code> in the Supabase SQL editor. Until
        then these settings apply to the single legacy line.
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2">
      <PhoneIncoming className="h-4 w-4 text-navy-600" />
      <span className="text-sm font-medium text-slate-700">Intake line</span>
      <div className="w-64">
        <select className={selectClass} value={lineId ?? ''} onChange={(e) => setLineId(e.target.value)}>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.is_default ? ' (default)' : ''}
              {l.active ? '' : ' (inactive)'}
            </option>
          ))}
        </select>
      </div>
      <span className="text-xs text-slate-500">
        {line?.phone_numbers.length ? line.phone_numbers.join(', ') : 'No phone numbers yet'} · {hint}
      </span>
      <Link href="/inbound/lines" className="ml-auto text-xs font-medium text-navy-700 hover:underline">
        Manage lines
      </Link>
    </div>
  );
}

export function lineNameFor(lines: InboundLineRow[], id: string | null | undefined): string {
  if (!id) return '—';
  return lines.find((l) => l.id === id)?.name ?? '—';
}
