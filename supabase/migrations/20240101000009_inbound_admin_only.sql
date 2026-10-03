-- Only admins (case_tracker_is_admin: admin / super_admin) may change inbound settings and agent instructions.
-- Staff with an active role can still read them (the dashboard and call pages show flag state).

DROP POLICY IF EXISTS inbound_settings_update ON public.inbound_settings;
CREATE POLICY inbound_settings_update ON public.inbound_settings
  FOR UPDATE TO authenticated
  USING (public.case_tracker_is_admin())
  WITH CHECK (public.case_tracker_is_admin());

DROP POLICY IF EXISTS inbound_agent_instructions_insert ON public.inbound_agent_instructions;
CREATE POLICY inbound_agent_instructions_insert ON public.inbound_agent_instructions
  FOR INSERT TO authenticated
  WITH CHECK (public.case_tracker_is_admin());

DROP POLICY IF EXISTS inbound_agent_instructions_update ON public.inbound_agent_instructions;
CREATE POLICY inbound_agent_instructions_update ON public.inbound_agent_instructions
  FOR UPDATE TO authenticated
  USING (public.case_tracker_is_admin())
  WITH CHECK (public.case_tracker_is_admin());
