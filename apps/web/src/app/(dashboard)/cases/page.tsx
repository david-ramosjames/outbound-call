import { createClient } from '@/lib/supabase/server';
import { CasesList } from '@/components/cases/cases-list';

export default async function CasesPage() {
  const supabase = await createClient();

  const { data: cases } = await supabase
    .from('cases')
    .select('id, name, case_number, client_name, case_type, status')
    .order('created_at', { ascending: false })
    .limit(200);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Cases</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage your law firm cases and AI outbound calls.
        </p>
      </div>

      <CasesList cases={cases ?? []} />
    </div>
  );
}
