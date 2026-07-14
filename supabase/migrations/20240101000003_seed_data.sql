-- Seed: Default voice settings
INSERT INTO public.voice_settings (
  ai_disclosure_text,
  recording_disclosure_text,
  recording_enabled,
  allowed_call_start_time,
  allowed_call_end_time,
  maximum_call_duration_seconds,
  maximum_hold_duration_seconds,
  default_voice,
  is_enabled
) VALUES (
  'Hello, I''m an AI-assisted calling agent contacting you on behalf of Ramos James Law regarding a client insurance matter.',
  'This call may be recorded for quality assurance purposes.',
  false,
  '09:00',
  '17:00',
  1800,
  600,
  'alloy',
  true
);

-- Seed: Open Insurance Claim template
INSERT INTO public.call_mission_templates (
  name,
  mission_type,
  description,
  default_goal,
  default_objectives,
  default_success_criteria,
  default_allowed_disclosures,
  default_restricted_topics,
  default_escalation_rules,
  is_active
) VALUES (
  'Open Insurance Claim',
  'open_insurance_claim',
  'Open a new bodily-injury insurance claim on behalf of the law firm''s client and collect the resulting claim and adjuster information.',
  'Open a new bodily-injury insurance claim on behalf of the law firm''s client and collect the resulting claim and adjuster information.',
  '["Reach the correct claims department","Explain that the firm represents the client","Provide approved administrative information","Open the claim","Obtain the claim number","Obtain the adjuster''s name, if assigned","Obtain the adjuster''s phone number","Obtain the adjuster''s email address","Obtain a fax number or mailing address if relevant","Identify any requested documentation","Identify any missing information preventing completion","Identify the next step","Identify a reasonable follow-up date"]'::jsonb,
  '["The claim is confirmed as opened","A claim number is obtained"]'::jsonb,
  '["Law firm name and contact information","Attorney name","Client name","Date of loss","Policy number when available","Basic incident description","Representation status"]'::jsonb,
  '["Settlement value or negotiation","Liability admissions","Detailed medical information","Legal strategy","Client statements","Social security numbers","Banking or payment information","Unrelated case information"]'::jsonb,
  '["Legal advice or judgment is requested","The representative requests a client statement","The representative requests an attorney statement","Settlement value is discussed","Liability admissions are requested","The AI is asked to verify identity using unavailable or restricted data","A dispute develops","Sensitive information outside the approved context is requested","A representative refuses to speak with an AI","The representative requests a human","The AI is not confident it has the correct answer","The requested action exceeds the defined mission"]'::jsonb,
  true
);
