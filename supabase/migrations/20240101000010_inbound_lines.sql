-- Multiple intake lines (one per firm / brand): each has its own phone numbers, Sign Flow
-- account, settings, and versioned agent instructions. Calls are routed by the number dialed.
-- Seeds the existing configuration as the default line. Safe to re-run. Includes 009 (admin-only).

-- ---------- Lines ----------
CREATE TABLE IF NOT EXISTS public.inbound_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  -- E.164 numbers whose calls this line answers (the Twilio numbers Quo forwards to).
  phone_numbers text[] NOT NULL DEFAULT '{}',
  -- Sign Flow firm id used for agreements (e.g. ramos-james).
  signflow_firm_id text NOT NULL DEFAULT '',
  -- Answers calls to numbers no other line claims.
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  business_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  routing jsonb NOT NULL DEFAULT '{}'::jsonb,
  contracts jsonb NOT NULL DEFAULT '{}'::jsonb,
  qualification jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inbound_lines_one_default ON public.inbound_lines (is_default) WHERE is_default;
CREATE INDEX IF NOT EXISTS inbound_lines_phone_numbers_idx ON public.inbound_lines USING gin (phone_numbers);

DROP TRIGGER IF EXISTS inbound_lines_updated_at ON public.inbound_lines;
CREATE TRIGGER inbound_lines_updated_at BEFORE UPDATE ON public.inbound_lines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO public.inbound_lines (name, slug, signflow_firm_id, is_default, flags, business_hours, routing, contracts, qualification)
SELECT 'Ramos James Law', 'ramos-james', 'ramos-james', true, s.flags, s.business_hours, s.routing, s.contracts, s.qualification
FROM public.inbound_settings s
WHERE s.id = 1 AND NOT EXISTS (SELECT 1 FROM public.inbound_lines);

INSERT INTO public.inbound_lines (name, slug, signflow_firm_id, is_default)
SELECT 'Ramos James Law', 'ramos-james', 'ramos-james', true
WHERE NOT EXISTS (SELECT 1 FROM public.inbound_lines);

-- ---------- Global integration settings (non-secret) ----------
ALTER TABLE public.inbound_settings ADD COLUMN IF NOT EXISTS integrations jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ---------- Instructions per line ----------
ALTER TABLE public.inbound_agent_instructions
  ADD COLUMN IF NOT EXISTS line_id uuid REFERENCES public.inbound_lines(id) ON DELETE CASCADE;
UPDATE public.inbound_agent_instructions
  SET line_id = (SELECT id FROM public.inbound_lines WHERE is_default LIMIT 1)
  WHERE line_id IS NULL;
ALTER TABLE public.inbound_agent_instructions DROP CONSTRAINT IF EXISTS inbound_agent_instructions_version_key;
CREATE UNIQUE INDEX IF NOT EXISTS inbound_agent_instructions_line_version ON public.inbound_agent_instructions (line_id, version);
DROP INDEX IF EXISTS public.inbound_agent_instructions_one_active;
CREATE UNIQUE INDEX IF NOT EXISTS inbound_agent_instructions_one_active_per_line
  ON public.inbound_agent_instructions (line_id) WHERE is_active;

-- ---------- Calls and intakes remember their line ----------
ALTER TABLE public.inbound_calls ADD COLUMN IF NOT EXISTS line_id uuid REFERENCES public.inbound_lines(id) ON DELETE SET NULL;
ALTER TABLE public.inbound_intakes ADD COLUMN IF NOT EXISTS line_id uuid REFERENCES public.inbound_lines(id) ON DELETE SET NULL;
UPDATE public.inbound_calls SET line_id = (SELECT id FROM public.inbound_lines WHERE is_default LIMIT 1) WHERE line_id IS NULL;
UPDATE public.inbound_intakes SET line_id = (SELECT id FROM public.inbound_lines WHERE is_default LIMIT 1) WHERE line_id IS NULL;
CREATE INDEX IF NOT EXISTS inbound_calls_line_idx ON public.inbound_calls (line_id, started_at DESC);
CREATE INDEX IF NOT EXISTS inbound_intakes_line_idx ON public.inbound_intakes (line_id, created_at DESC);

-- ---------- RLS: inbound is admin-only (admin / super_admin). The voice worker uses the service role. ----------
ALTER TABLE public.inbound_lines ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'inbound_settings', 'inbound_lines', 'inbound_agent_instructions', 'inbound_calls', 'inbound_intakes',
    'inbound_transcript_segments', 'inbound_audit_events', 'inbound_callback_requests'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.case_tracker_is_admin())',
      t || '_select', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['inbound_settings', 'inbound_lines', 'inbound_agent_instructions', 'inbound_intakes', 'inbound_callback_requests'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.case_tracker_is_admin()) WITH CHECK (public.case_tracker_is_admin())',
      t || '_update', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['inbound_lines', 'inbound_agent_instructions', 'inbound_audit_events'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.case_tracker_is_admin())',
      t || '_insert', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS inbound_lines_delete ON public.inbound_lines;
CREATE POLICY inbound_lines_delete ON public.inbound_lines
  FOR DELETE TO authenticated USING (public.case_tracker_is_admin() AND NOT is_default);
