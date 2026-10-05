import type { createClient } from '@/lib/supabase/server';

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Line id → name, or null before migration 010 (then line_id columns don't exist yet). */
export async function loadLineNames(supabase: ServerClient): Promise<Record<string, string> | null> {
  const { data, error } = await supabase.from('inbound_lines').select('id, name');
  if (error) return null;
  return Object.fromEntries((data ?? []).map((l) => [l.id as string, l.name as string]));
}
