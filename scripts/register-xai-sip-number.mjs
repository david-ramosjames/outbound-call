#!/usr/bin/env node
/**
 * Register (or re-register) an xAI Direct SIP number so incoming calls are
 * dispatched to OUR voice worker via webhook — instead of being handled by a
 * managed xAI Agent.
 *
 * xAI's `agent_id` and `webhook` are mutually exclusive on a phone number.
 * Pointing the number at our webhook is what lets the worker drive the call
 * with the per-call outbound mission prompt and capture transcripts.
 *
 * Usage (PowerShell):
 *   $env:XAI_API_KEY="xai-..."
 *   node scripts/register-xai-sip-number.mjs `
 *     --phone "+1XXXXXXXXXX" `
 *     --webhook "https://<your-voice-worker>.up.railway.app/webhooks/xai/sip" `
 *     --name "Ramos James Outbound"
 *
 * On success it prints the webhook signing secret (whsec_...). Copy that value
 * into the voice worker's XAI_SIP_WEBHOOK_SECRET env var (Railway) and redeploy.
 * The secret is returned ONLY ONCE and cannot be recovered.
 */

const args = parseArgs(process.argv.slice(2));
const apiKey = process.env.XAI_API_KEY;
const phone = args.phone;
const webhookUrl = args.webhook;
const name = args.name ?? 'Ramos James Outbound';

if (!apiKey) fail('Set XAI_API_KEY in the environment.');
if (!phone || !/^\+\d{8,15}$/.test(phone))
  fail('Pass --phone in E.164 format, e.g. --phone "+13135551234".');
if (!webhookUrl || !/^https:\/\//.test(webhookUrl))
  fail('Pass --webhook as an https URL ending in /webhooks/xai/sip.');

const body = {
  origin: 'byo_trunk',
  name,
  phone_number: phone,
  webhook: {
    name,
    url: webhookUrl,
  },
};

console.log('Registering Direct SIP number with xAI...');
console.log(JSON.stringify(body, null, 2));

const res = await fetch('https://api.x.ai/v2/phone-numbers', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});

const text = await res.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  json = text;
}

if (!res.ok) {
  console.error(`\nxAI returned ${res.status}:`);
  console.error(typeof json === 'string' ? json : JSON.stringify(json, null, 2));
  console.error(
    '\nIf the number already exists routed to an agent, delete/detach it in the xAI console first, then re-run.',
  );
  process.exit(1);
}

console.log('\nSuccess. Full response:');
console.log(JSON.stringify(json, null, 2));

const secret = json?.webhook?.dispatch_signing_secret;
if (secret) {
  console.log('\n==================================================');
  console.log('WEBHOOK SIGNING SECRET (store now — shown only once):');
  console.log(secret);
  console.log('Set this as XAI_SIP_WEBHOOK_SECRET on the voice worker.');
  console.log('==================================================');
} else {
  console.log('\nNo dispatch_signing_secret in response — check the JSON above.');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}
