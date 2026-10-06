-- Outbound: let the AI press keys in carrier phone menus (calls are bridged through a Twilio conference).
-- Off by default.
ALTER TABLE voice_settings
  ADD COLUMN IF NOT EXISTS keypad_enabled boolean NOT NULL DEFAULT false;
