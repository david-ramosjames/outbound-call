-- Inbound intake is admin-only (case_tracker_is_admin: admin / super_admin) for reads and writes.
-- The voice worker uses the service role and is unaffected.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'inbound_settings', 'inbound_agent_instructions', 'inbound_calls', 'inbound_intakes',
    'inbound_transcript_segments', 'inbound_audit_events', 'inbound_callback_requests'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.case_tracker_is_admin())',
      t || '_select', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['inbound_settings', 'inbound_agent_instructions', 'inbound_intakes', 'inbound_callback_requests'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.case_tracker_is_admin()) WITH CHECK (public.case_tracker_is_admin())',
      t || '_update', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['inbound_agent_instructions', 'inbound_audit_events'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.case_tracker_is_admin())',
      t || '_insert', t);
  END LOOP;
END $$;
