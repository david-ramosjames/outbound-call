-- Post finished inbound calls (summary + transcript) to each firm's Slack lead calls channel,
-- threaded under the caller's existing post when there is one. Off unless a line turns it on.
ALTER TABLE public.inbound_lines ADD COLUMN IF NOT EXISTS slack jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.inbound_settings ADD COLUMN IF NOT EXISTS slack jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.inbound_calls ADD COLUMN IF NOT EXISTS slack_channel_id text;
ALTER TABLE public.inbound_calls ADD COLUMN IF NOT EXISTS slack_message_ts text;
ALTER TABLE public.inbound_calls ADD COLUMN IF NOT EXISTS slack_thread_ts text;

-- Ramos James Law: #lead-calls (only if Slack hasn't been configured for the line yet).
UPDATE public.inbound_lines
SET slack = '{"enabled": true, "channel_id": "C026G89PPSS", "thread_by_phone": true, "include_transcript": true}'::jsonb
WHERE name = 'Ramos James Law' AND slack = '{}'::jsonb;
