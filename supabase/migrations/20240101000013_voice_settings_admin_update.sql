-- Settings → Voice saves from the browser as the signed-in user; until now only the service role could write,
-- so saves silently changed nothing. Let admins update the outbound voice settings row.
DROP POLICY IF EXISTS "Admins can update voice settings" ON public.voice_settings;
CREATE POLICY "Admins can update voice settings"
  ON public.voice_settings
  FOR UPDATE
  USING (public.case_tracker_is_admin())
  WITH CHECK (public.case_tracker_is_admin());
