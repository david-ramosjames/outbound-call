import { createClient } from '@/lib/supabase/server';
import { CasesList, type CaseListItem } from '@/components/cases/cases-list';

const PAGE_SIZE = 1000;

async function fetchAllActiveCases(): Promise<{
  cases: CaseListItem[];
  error: string | null;
}> {
  const supabase = await createClient();
  const all: CaseListItem[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('cases')
      .select('id, name, case_number, client_name, case_type, status')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return { cases: all, error: error.message };
    }

    const batch = (data ?? []) as CaseListItem[];
    all.push(...batch);

    if (batch.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return { cases: all, error: null };
}

export default async function CasesPage() {
  const { cases, error } = await fetchAllActiveCases();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Cases</h1>
        <p className="text-sm text-slate-500 mt-1">
          {error
            ? 'Unable to load all cases.'
            : `${cases.length} active case${cases.length === 1 ? '' : 's'}`}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <CasesList cases={cases} />
    </div>
  );
}
