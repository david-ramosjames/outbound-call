-- Row Level Security Policies for AI Outbound Calling

-- Enable RLS on all tables
ALTER TABLE public.call_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_transcript_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_result_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_proposed_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_mission_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_phone_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_settings ENABLE ROW LEVEL SECURITY;

-- Helper: Check if user has an active role
CREATE OR REPLACE FUNCTION public.user_has_active_role(check_user_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.case_tracker_user_roles
    WHERE user_id = check_user_id AND active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: Check if user has access to a case
CREATE OR REPLACE FUNCTION public.user_can_access_case(check_user_id uuid, check_case_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cases
    WHERE id = check_case_id
    AND (
      user_id = check_user_id
      OR check_user_id = ANY(assigned_contact_ids)
      OR public.user_has_active_role(check_user_id)
    )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Call Missions: Users can see missions for cases they have access to
CREATE POLICY "Users can view their accessible call missions"
  ON public.call_missions FOR SELECT
  USING (public.user_can_access_case(auth.uid(), case_id));

CREATE POLICY "Users can create call missions for accessible cases"
  ON public.call_missions FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND public.user_can_access_case(auth.uid(), case_id)
    AND public.user_has_active_role(auth.uid())
  );

CREATE POLICY "Users can update their own draft missions"
  ON public.call_missions FOR UPDATE
  USING (
    public.user_can_access_case(auth.uid(), case_id)
    AND public.user_has_active_role(auth.uid())
  );

-- Call Sessions: Accessible via mission
CREATE POLICY "Users can view call sessions for accessible missions"
  ON public.call_sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.call_missions m
      WHERE m.id = call_mission_id
      AND public.user_can_access_case(auth.uid(), m.case_id)
    )
  );

-- Service role can insert/update call sessions (voice worker uses service role)
CREATE POLICY "Service role manages call sessions"
  ON public.call_sessions FOR ALL
  USING (auth.role() = 'service_role');

-- Call Events: Accessible via mission
CREATE POLICY "Users can view call events for accessible missions"
  ON public.call_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.call_missions m
      WHERE m.id = call_mission_id
      AND public.user_can_access_case(auth.uid(), m.case_id)
    )
  );

CREATE POLICY "Service role manages call events"
  ON public.call_events FOR ALL
  USING (auth.role() = 'service_role');

-- Transcript Segments: Accessible via mission
CREATE POLICY "Users can view transcripts for accessible missions"
  ON public.call_transcript_segments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.call_missions m
      WHERE m.id = call_mission_id
      AND public.user_can_access_case(auth.uid(), m.case_id)
    )
  );

CREATE POLICY "Service role manages transcript segments"
  ON public.call_transcript_segments FOR ALL
  USING (auth.role() = 'service_role');

-- Call Results: Accessible via mission
CREATE POLICY "Users can view call results for accessible missions"
  ON public.call_results FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.call_missions m
      WHERE m.id = call_mission_id
      AND public.user_can_access_case(auth.uid(), m.case_id)
    )
  );

CREATE POLICY "Service role manages call results"
  ON public.call_results FOR ALL
  USING (auth.role() = 'service_role');

-- Call Result Fields: Accessible via result -> mission
CREATE POLICY "Users can view result fields for accessible missions"
  ON public.call_result_fields FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.call_results r
      JOIN public.call_missions m ON m.id = r.call_mission_id
      WHERE r.id = call_result_id
      AND public.user_can_access_case(auth.uid(), m.case_id)
    )
  );

CREATE POLICY "Users can update result fields for review"
  ON public.call_result_fields FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.call_results r
      JOIN public.call_missions m ON m.id = r.call_mission_id
      WHERE r.id = call_result_id
      AND public.user_can_access_case(auth.uid(), m.case_id)
      AND public.user_has_active_role(auth.uid())
    )
  );

CREATE POLICY "Service role manages result fields"
  ON public.call_result_fields FOR ALL
  USING (auth.role() = 'service_role');

-- Proposed Updates: Accessible via mission
CREATE POLICY "Users can view proposed updates for accessible missions"
  ON public.call_proposed_updates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.call_missions m
      WHERE m.id = call_mission_id
      AND public.user_can_access_case(auth.uid(), m.case_id)
    )
  );

CREATE POLICY "Users can update proposed updates for review"
  ON public.call_proposed_updates FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.call_missions m
      WHERE m.id = call_mission_id
      AND public.user_can_access_case(auth.uid(), m.case_id)
      AND public.user_has_active_role(auth.uid())
    )
  );

CREATE POLICY "Service role manages proposed updates"
  ON public.call_proposed_updates FOR ALL
  USING (auth.role() = 'service_role');

-- Mission Templates: All authenticated users can read
CREATE POLICY "Authenticated users can view templates"
  ON public.call_mission_templates FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role manages templates"
  ON public.call_mission_templates FOR ALL
  USING (auth.role() = 'service_role');

-- Blocked Phone Numbers: All active users can read
CREATE POLICY "Active users can view blocked numbers"
  ON public.blocked_phone_numbers FOR SELECT
  USING (public.user_has_active_role(auth.uid()));

CREATE POLICY "Active users can manage blocked numbers"
  ON public.blocked_phone_numbers FOR INSERT
  WITH CHECK (public.user_has_active_role(auth.uid()));

CREATE POLICY "Service role manages blocked numbers"
  ON public.blocked_phone_numbers FOR ALL
  USING (auth.role() = 'service_role');

-- Voice Settings: All active users can read
CREATE POLICY "Active users can view voice settings"
  ON public.voice_settings FOR SELECT
  USING (public.user_has_active_role(auth.uid()));

CREATE POLICY "Service role manages voice settings"
  ON public.voice_settings FOR ALL
  USING (auth.role() = 'service_role');
