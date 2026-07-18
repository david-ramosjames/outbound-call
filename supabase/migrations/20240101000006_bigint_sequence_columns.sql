-- Code uses epoch-ms values (Date.now()) which overflow int4
ALTER TABLE public.call_events
  ALTER COLUMN sequence_number TYPE bigint;

ALTER TABLE public.call_transcript_segments
  ALTER COLUMN sequence_number TYPE bigint,
  ALTER COLUMN start_time_ms TYPE bigint,
  ALTER COLUMN end_time_ms TYPE bigint;
