-- Firm user roles used by call mission RLS helpers
CREATE TABLE IF NOT EXISTS public.case_tracker_user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'staff',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_tracker_user_roles_user_id_key UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_case_tracker_user_roles_user_id
  ON public.case_tracker_user_roles(user_id);

ALTER TABLE public.case_tracker_user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own role" ON public.case_tracker_user_roles;
CREATE POLICY "Users can view own role"
  ON public.case_tracker_user_roles FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages user roles" ON public.case_tracker_user_roles;
CREATE POLICY "Service role manages user roles"
  ON public.case_tracker_user_roles FOR ALL
  USING (auth.role() = 'service_role');

-- Ensure the signed-in user has an active firm role (for call mission RLS)
CREATE OR REPLACE FUNCTION public.ensure_user_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.case_tracker_user_roles (user_id, role, active)
  VALUES (auth.uid(), 'staff', true)
  ON CONFLICT (user_id) DO UPDATE
    SET active = true,
        updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_user_role() TO authenticated;
