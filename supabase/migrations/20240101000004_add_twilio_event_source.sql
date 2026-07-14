-- Add 'twilio' to call_event_source enum
ALTER TYPE call_event_source ADD VALUE IF NOT EXISTS 'twilio';
