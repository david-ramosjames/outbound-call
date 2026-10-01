-- Why a call ended the way it did (completed, carrier_refused_ai, unable_to_reach_representative, ...)
ALTER TABLE public.call_missions
  ADD COLUMN IF NOT EXISTS outcome_reason text;

CREATE INDEX IF NOT EXISTS idx_call_missions_org_outcome_reason
  ON public.call_missions (organization_name, mission_type, outcome_reason);
