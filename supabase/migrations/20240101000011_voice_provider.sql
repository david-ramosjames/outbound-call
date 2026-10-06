-- Outbound calls can run on Grok (xAI) or OpenAI. Each provider keeps its own voice choice.
-- Inbound lines store the same choice in inbound_lines.routing (voice_provider, openai_voice), so they need no migration.
ALTER TABLE public.voice_settings ADD COLUMN IF NOT EXISTS voice_provider text NOT NULL DEFAULT 'xai';
ALTER TABLE public.voice_settings ADD COLUMN IF NOT EXISTS openai_voice text NOT NULL DEFAULT 'marin';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voice_settings_voice_provider_check') THEN
    ALTER TABLE public.voice_settings
      ADD CONSTRAINT voice_settings_voice_provider_check CHECK (voice_provider IN ('xai', 'openai'));
  END IF;
END $$;
