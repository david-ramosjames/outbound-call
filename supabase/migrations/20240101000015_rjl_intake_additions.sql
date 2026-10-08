-- Ramos James Law intake line: additions to the intake protocol (property damage, medical
-- treatment, overall process, after signing, injury referrals). Run after 014.
-- Adds these keys to the line's active instructions; every other key (including UI edits) is kept.
UPDATE public.inbound_agent_instructions i
SET content = i.content || $json${
"property_damage_language": "Always say yes, we help with property damage. Here's how: we don't take over the property damage claim, because we would have to charge attorney's fees on it, and if your car is worth $10,000 you would end up with less than the value of your car. What we do is stay right by your side, reviewing everything and assisting you, so we're essentially handling it through you. It also avoids delays in communication, because we're not stuck in the middle as the messenger.",
"medical_treatment_language": "We can set you up with medical providers we work with. There's no upfront, out-of-pocket cost for your treatment, and you don't need health insurance to get care.",
"process_overview": "A lead attorney and a paralegal are assigned to the case, and the whole team works on it together. We help them get the medical care they need, we handle the insurance company for them, and we try to resolve the case with a claim first; our attorneys always talk with them before any lawsuit is considered. Their paralegal will reach out within a couple of business days to introduce themselves and help put their file together.",
"after_signing_language": "Thank you for trusting Ramos James Law. Please save our direct number: 512-537-3369. We're always available to answer any immediate questions. Your paralegal will reach out within the next couple of business days to introduce themselves.",
"injury_referral_language": "I'm so sorry you're dealing with this. I want to make sure you get the best help possible, so I'd like to help you get a second opinion from an attorney who can look at your situation. The Lawyer Referral Service of Central Texas can connect you with one. Their number is 512-472-8303. Would you like me to repeat that?"
}$json$::jsonb
FROM public.inbound_lines l
WHERE i.line_id = l.id
  AND l.name = 'Ramos James Law'
  AND i.is_active;
