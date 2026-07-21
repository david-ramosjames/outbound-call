#!/usr/bin/env node
/**
 * Manage xAI Direct SIP phone numbers for self-driven (webhook) calls.
 *
 * xAI's `agent_id` and `webhook` are mutually exclusive. If a number is already
 * registered to a managed Agent, POST create returns 409 — delete it first,
 * then re-register with a webhook pointing at our worker.
 *
 * Commands:
 *   list
 *   delete --id <phone_number_id>
 *   register --phone +1... --webhook https://.../webhooks/xai/sip [--name "..."]
 *
 * Usage (PowerShell):
 *   $env:XAI_API_KEY="xai-..."
 *   node scripts/register-xai-sip-number.mjs list
 *   node scripts/register-xai-sip-number.mjs delete --id pn_xxx
 *   node scripts/register-xai-sip-number.mjs register `
 *     --phone "+17372045615" `
 *     --webhook "https://outbound-callvoice-worker-production.up.railway.app/webhooks/xai/sip" `
 *     --name "Ramos James Outbound"
 */

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const apiKey = process.env.XAI_API_KEY;

if (!apiKey) fail('Set XAI_API_KEY in the environment.');
if (!command || !['list', 'delete', 'register'].includes(command)) {
  fail('Usage: node scripts/register-xai-sip-number.mjs <list|delete|register> ...');
}

if (command === 'list') {
  await listNumbers();
} else if (command === 'delete') {
  await deleteNumber(args.id);
} else {
  await registerNumber(args);
}

async function listNumbers() {
  // Try documented-ish list paths; xAI may return 404 on some.
  const paths = ['/v2/phone-numbers', '/v1/phone-numbers'];
  for (const path of paths) {
    const res = await xai(path, { method: 'GET' });
    console.log(`GET ${path} → ${res.status}`);
    console.log(typeof res.json === 'string' ? res.json : JSON.stringify(res.json, null, 2));
    if (res.ok) return;
  }
  console.error(
    '\nCould not list via API. In the xAI console, open the Direct SIP number row (… menu) and Delete / Detach it, then re-run register.',
  );
  process.exit(1);
}

async function deleteNumber(id) {
  if (!id) fail('Pass --id <phone_number_id> (from list, or the console).');

  const paths = [
    `/v2/phone-numbers/${encodeURIComponent(id)}`,
    `/v1/phone-numbers/${encodeURIComponent(id)}`,
  ];

  for (const path of paths) {
    const res = await xai(path, { method: 'DELETE' });
    console.log(`DELETE ${path} → ${res.status}`);
    console.log(typeof res.json === 'string' ? res.json : JSON.stringify(res.json, null, 2));
    if (res.ok || res.status === 204) {
      console.log('\nDeleted. Now run the register command.');
      return;
    }
  }

  fail(
    'API delete failed. In the xAI console: click … on the "twillio" / +17372045615 row → Delete (or Detach from agent), then run register again.',
  );
}

async function registerNumber(args) {
  const phone = args.phone;
  const webhookUrl = args.webhook;
  const name = args.name ?? 'Ramos James Outbound';

  if (!phone || !/^\+\d{8,15}$/.test(phone))
    fail('Pass --phone in E.164 format, e.g. --phone "+17372045615".');
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

  const res = await xai('/v2/phone-numbers', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error(`\nxAI returned ${res.status}:`);
    console.error(typeof res.json === 'string' ? res.json : JSON.stringify(res.json, null, 2));
    if (res.status === 409) {
      console.error(`
The number is already registered (usually to a managed Agent).

Do this:
  1. In the xAI console, open the phone numbers list.
  2. Click … on "+1 (737) 204-5615" / "twillio".
  3. Choose Delete (or Detach from agent).
  4. Optionally verify:  node scripts/register-xai-sip-number.mjs list
  5. Re-run register.
`);
    }
    process.exit(1);
  }

  console.log('\nSuccess. Full response:');
  console.log(JSON.stringify(res.json, null, 2));

  const secret =
    res.json?.webhook?.dispatch_signing_secret ??
    res.json?.webhook?.dispatchSigningSecret;
  if (secret) {
    console.log('\n==================================================');
    console.log('WEBHOOK SIGNING SECRET (store now — shown only once):');
    console.log(secret);
    console.log('Set this as XAI_SIP_WEBHOOK_SECRET on the voice worker.');
    console.log('==================================================');
  } else {
    console.log('\nNo dispatch signing secret in response — check the JSON above.');
  }
}

async function xai(path, { method, body } = {}) {
  const res = await fetch(`https://api.x.ai${path}`, {
    method: method ?? 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { ok: res.ok, status: res.status, json };
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
