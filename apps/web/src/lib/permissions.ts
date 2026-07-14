import { createClient } from '@/lib/supabase/server';

export async function canAccessCase(userId: string, caseId: string): Promise<boolean> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('cases')
    .select('id')
    .eq('id', caseId)
    .single();

  return !!data;
}

export async function canLaunchCalls(userId: string): Promise<boolean> {
  const hasRole = await hasActiveRole(userId);
  return hasRole;
}

export async function canReviewCalls(userId: string): Promise<boolean> {
  const hasRole = await hasActiveRole(userId);
  return hasRole;
}

export async function hasActiveRole(userId: string): Promise<boolean> {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.id !== userId) return false;

  return true;
}
