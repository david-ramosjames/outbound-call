-- AI Outbound Calling: Call Missions Schema
-- This migration creates all tables for the AI outbound calling feature.

-- Enum for call status
CREATE TYPE call_mission_status AS ENUM (
  'draft',
  'authorized',
  'queued',
  'initiating',
  'dialing',
  'ringing',
  'answered',
  'in_progress',
  'on_hold',
  'completed',
  'failed',
  'cancelled',
  'needs_human_follow_up',
  'awaiting_review',
  'reviewed'
);

-- Enum for mission outcome
CREATE TYPE mission_outcome AS ENUM (
  'success',
  'partial_success',
  'failure',
  'human_follow_up'
);

-- Enum for review status
CREATE TYPE call_review_status AS ENUM (
  'pending',
  'accepted',
  'edited',
  'rejected'
);

-- Enum for speaker type
CREATE TYPE call_speaker AS ENUM (
  'ai_agent',
  'insurance_representative',
  'automated_phone_system',
  'unknown'
);

-- Enum for event source
CREATE TYPE call_event_source AS ENUM (
  'telnyx',
  'xai',
  'system',
  'mock'
);

-- Call Mission Templates
CREATE TABLE public.call_mission_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  mission_type text NOT NULL,
  description text NOT NULL DEFAULT '',
  default_goal text NOT NULL DEFAULT '',
  default_objectives jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_success_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_allowed_disclosures jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_restricted_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_escalation_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_output_schema jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_mission_templates_pkey PRIMARY KEY (id)
);

-- Voice Settings
CREATE TABLE public.voice_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ai_disclosure_text text NOT NULL DEFAULT 'Hello, I''m an AI-assisted calling agent contacting you on behalf of Ramos James Law regarding a client insurance matter.',
  recording_disclosure_text text NOT NULL DEFAULT 'This call may be recorded for quality assurance purposes.',
  recording_enabled boolean NOT NULL DEFAULT false,
  allowed_call_start_time text NOT NULL DEFAULT '09:00',
  allowed_call_end_time text NOT NULL DEFAULT '17:00',
  maximum_call_duration_seconds integer NOT NULL DEFAULT 1800,
  maximum_hold_duration_seconds integer NOT NULL DEFAULT 600,
  default_voice text NOT NULL DEFAULT 'alloy',
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voice_settings_pkey PRIMARY KEY (id)
);

-- Blocked Phone Numbers
CREATE TABLE public.blocked_phone_numbers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  phone_number text NOT NULL,
  reason text,
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blocked_phone_numbers_pkey PRIMARY KEY (id),
  CONSTRAINT blocked_phone_numbers_added_by_fkey FOREIGN KEY (added_by) REFERENCES auth.users(id)
);

CREATE UNIQUE INDEX idx_blocked_phone_numbers_number ON public.blocked_phone_numbers(phone_number);

-- Call Missions
CREATE TABLE public.call_missions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL,
  mission_type text NOT NULL DEFAULT 'open_insurance_claim',
  title text NOT NULL,
  organization_name text NOT NULL,
  department text,
  contact_name text,
  destination_phone text NOT NULL,
  extension text,
  destination_timezone text NOT NULL DEFAULT 'America/Chicago',
  goal text NOT NULL,
  objectives jsonb NOT NULL DEFAULT '[]'::jsonb,
  success_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  approved_context jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_disclosures jsonb NOT NULL DEFAULT '[]'::jsonb,
  restricted_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  escalation_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_output_schema jsonb,
  prompt_snapshot text,
  authorization_snapshot jsonb,
  correlation_token uuid,
  status call_mission_status NOT NULL DEFAULT 'draft',
  outcome mission_outcome,
  created_by uuid NOT NULL,
  authorized_by uuid,
  authorized_at timestamptz,
  started_at timestamptz,
  answered_at timestamptz,
  completed_at timestamptz,
  duration_seconds integer,
  hold_duration_seconds integer,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_missions_pkey PRIMARY KEY (id),
  CONSTRAINT call_missions_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cases(id),
  CONSTRAINT call_missions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id),
  CONSTRAINT call_missions_authorized_by_fkey FOREIGN KEY (authorized_by) REFERENCES auth.users(id)
);

CREATE INDEX idx_call_missions_case_id ON public.call_missions(case_id);
CREATE INDEX idx_call_missions_status ON public.call_missions(status);
CREATE INDEX idx_call_missions_created_by ON public.call_missions(created_by);
CREATE INDEX idx_call_missions_correlation_token ON public.call_missions(correlation_token);

-- Call Sessions
CREATE TABLE public.call_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  call_mission_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'telnyx',
  telnyx_call_control_id text,
  telnyx_call_session_id text,
  telnyx_call_leg_id text,
  xai_call_id text,
  xai_connection_status text DEFAULT 'pending',
  sip_status text,
  started_at timestamptz,
  ended_at timestamptz,
  disconnect_reason text,
  provider_metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT call_sessions_call_mission_id_fkey FOREIGN KEY (call_mission_id) REFERENCES public.call_missions(id)
);

CREATE INDEX idx_call_sessions_mission_id ON public.call_sessions(call_mission_id);
CREATE INDEX idx_call_sessions_telnyx_control_id ON public.call_sessions(telnyx_call_control_id);
CREATE INDEX idx_call_sessions_xai_call_id ON public.call_sessions(xai_call_id);

-- Call Events
CREATE TABLE public.call_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  call_mission_id uuid NOT NULL,
  call_session_id uuid,
  source call_event_source NOT NULL,
  external_event_id text,
  event_type text NOT NULL,
  provider_status text,
  sequence_number integer NOT NULL DEFAULT 0,
  event_payload jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_events_pkey PRIMARY KEY (id),
  CONSTRAINT call_events_call_mission_id_fkey FOREIGN KEY (call_mission_id) REFERENCES public.call_missions(id),
  CONSTRAINT call_events_call_session_id_fkey FOREIGN KEY (call_session_id) REFERENCES public.call_sessions(id)
);

CREATE UNIQUE INDEX idx_call_events_source_external_id ON public.call_events(source, external_event_id) WHERE external_event_id IS NOT NULL;
CREATE INDEX idx_call_events_mission_id ON public.call_events(call_mission_id);
CREATE INDEX idx_call_events_session_id ON public.call_events(call_session_id);
CREATE INDEX idx_call_events_type ON public.call_events(event_type);

-- Call Transcript Segments
CREATE TABLE public.call_transcript_segments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  call_mission_id uuid NOT NULL,
  call_session_id uuid NOT NULL,
  source_event_id uuid,
  speaker call_speaker NOT NULL DEFAULT 'unknown',
  text text NOT NULL,
  start_time_ms integer NOT NULL DEFAULT 0,
  end_time_ms integer NOT NULL DEFAULT 0,
  sequence_number integer NOT NULL DEFAULT 0,
  is_final boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_transcript_segments_pkey PRIMARY KEY (id),
  CONSTRAINT call_transcript_segments_mission_id_fkey FOREIGN KEY (call_mission_id) REFERENCES public.call_missions(id),
  CONSTRAINT call_transcript_segments_session_id_fkey FOREIGN KEY (call_session_id) REFERENCES public.call_sessions(id),
  CONSTRAINT call_transcript_segments_event_id_fkey FOREIGN KEY (source_event_id) REFERENCES public.call_events(id)
);

CREATE INDEX idx_call_transcript_mission_id ON public.call_transcript_segments(call_mission_id);
CREATE INDEX idx_call_transcript_session_id ON public.call_transcript_segments(call_session_id);
CREATE INDEX idx_call_transcript_sequence ON public.call_transcript_segments(call_mission_id, sequence_number);

-- Call Results
CREATE TABLE public.call_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  call_mission_id uuid NOT NULL UNIQUE,
  mission_outcome mission_outcome NOT NULL,
  completion_status text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  structured_results jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_information jsonb NOT NULL DEFAULT '[]'::jsonb,
  commitments jsonb NOT NULL DEFAULT '[]'::jsonb,
  deadlines jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_action text,
  suggested_follow_up_date date,
  escalation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_results_pkey PRIMARY KEY (id),
  CONSTRAINT call_results_call_mission_id_fkey FOREIGN KEY (call_mission_id) REFERENCES public.call_missions(id)
);

CREATE INDEX idx_call_results_mission_id ON public.call_results(call_mission_id);

-- Call Result Fields
CREATE TABLE public.call_result_fields (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  call_result_id uuid NOT NULL,
  field_key text NOT NULL,
  field_label text NOT NULL,
  extracted_value jsonb,
  confidence numeric NOT NULL DEFAULT 0,
  evidence_segment_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_start_time_ms integer,
  evidence_end_time_ms integer,
  review_status call_review_status NOT NULL DEFAULT 'pending',
  reviewed_value jsonb,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_result_fields_pkey PRIMARY KEY (id),
  CONSTRAINT call_result_fields_call_result_id_fkey FOREIGN KEY (call_result_id) REFERENCES public.call_results(id),
  CONSTRAINT call_result_fields_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id)
);

CREATE INDEX idx_call_result_fields_result_id ON public.call_result_fields(call_result_id);

-- Call Proposed Updates
CREATE TABLE public.call_proposed_updates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  call_mission_id uuid NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  target_field text NOT NULL,
  current_value jsonb,
  proposed_value jsonb NOT NULL,
  reason text NOT NULL DEFAULT '',
  review_status call_review_status NOT NULL DEFAULT 'pending',
  reviewed_value jsonb,
  reviewed_by uuid,
  reviewed_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_proposed_updates_pkey PRIMARY KEY (id),
  CONSTRAINT call_proposed_updates_mission_id_fkey FOREIGN KEY (call_mission_id) REFERENCES public.call_missions(id),
  CONSTRAINT call_proposed_updates_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id)
);

CREATE INDEX idx_call_proposed_updates_mission_id ON public.call_proposed_updates(call_mission_id);
CREATE INDEX idx_call_proposed_updates_status ON public.call_proposed_updates(review_status);

-- Updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_call_missions_updated_at
  BEFORE UPDATE ON public.call_missions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_call_sessions_updated_at
  BEFORE UPDATE ON public.call_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_call_results_updated_at
  BEFORE UPDATE ON public.call_results
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_call_result_fields_updated_at
  BEFORE UPDATE ON public.call_result_fields
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_voice_settings_updated_at
  BEFORE UPDATE ON public.voice_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_call_mission_templates_updated_at
  BEFORE UPDATE ON public.call_mission_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
