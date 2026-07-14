# AI Outbound Calling - Case Tracker

An AI-powered outbound calling feature for a personal-injury law firm's Case Tracker. Uses xAI's Grok Voice Agent API with Direct SIP integration and Telnyx for PSTN connectivity to automate administrative insurance claim calls.

## Architecture

```
Case Tracker UI (Next.js)
      ↓
Next.js API Routes / Server Actions
      ↓
Supabase (call_missions record)
      ↓
Railway Voice Orchestrator (Node.js)
      ↓
Telnyx (outbound PSTN call)
      ↓
xAI Direct SIP endpoint
      ↓
Grok Voice Agent (real-time conversation)
      ↓
Insurance carrier representative
```

### Why No Vapi/Retell/Bland

This system uses xAI's Voice Agent API directly with a Bring Your Own Trunk (BYO) SIP integration through Telnyx. This approach provides:

- **Direct control** over call routing, prompting, and data handling
- **No intermediary** between the law firm's data and the AI agent
- **Full audit trail** of every instruction sent to Grok
- **Minimal data exposure** — only explicitly approved context reaches the AI
- **Carrier-level control** via Telnyx call control API
- **Cost transparency** — no markup from orchestration platforms

### Services

| Service | Location | Runtime | Purpose |
|---------|----------|---------|---------|
| Web App | `apps/web` | Next.js on Railway | UI, auth, mission creation, review |
| Voice Worker | `apps/voice-worker` | Node.js on Railway | Call orchestration, webhooks, xAI WebSocket |
| Database | Supabase | Postgres | Data, auth, RLS |

### Call Flow

1. User creates a Call Mission with approved context
2. User authorizes the call
3. Web app queues the mission and notifies the voice worker
4. Voice worker uses Telnyx to place outbound PSTN call
5. Telnyx bridges the call to xAI's registered SIP endpoint
6. xAI sends a `realtime.call.incoming` webhook to the voice worker
7. Voice worker extracts the `call_id` and opens a realtime WebSocket
8. Grok is configured with mission-specific instructions and tools
9. Grok conducts the conversation within defined restrictions
10. All events, transcript segments, and tool results are saved
11. Post-call processor generates structured results
12. Human reviews and approves/rejects all extracted data

### Mission Correlation

Calls are correlated across systems using:
- A `correlation_token` (UUID) stored on the mission
- Passed to Telnyx via `client_state` (base64 encoded)
- Used in SIP headers for xAI correlation
- Never contains sensitive case data — only an opaque identifier

## Local Setup

### Prerequisites

- Node.js 20+
- pnpm 9+
- Supabase CLI (for local development)
- A Telnyx account with:
  - A phone number
  - An outbound voice profile
  - A SIP connection
- An xAI account with Voice Agent API access

### Installation

```bash
# Clone and install
git clone <repo-url> outbound-call
cd outbound-call
pnpm install

# Copy environment variables
cp .env.example .env

# Run database migrations (requires Supabase CLI or hosted instance)
pnpm db:migrate
```

### Development

```bash
# Run both services
pnpm dev

# Or run individually
pnpm dev:web    # Next.js on port 3000
pnpm dev:voice  # Voice worker on port 3001
```

### Mock Mode

Set `VOICE_MODE=mock` in `.env` to run without real phone calls. Mock mode:
- Never initiates real Telnyx calls
- Simulates realistic call progression
- Generates sample transcripts and results
- Exercises the full review workflow
- Shows a prominent banner in the UI

Available mock scenarios:
1. `claim_opened_successfully` - Full successful flow
2. `existing_claim_found` - Existing claim located
3. `missing_policy_number` - Policy info needed
4. `police_report_requested` - Documentation required
5. `adjuster_assigned` - Full adjuster info received
6. `no_adjuster_assigned` - Claim opened, no adjuster yet
7. `voicemail` - Reaches voicemail
8. `ai_interaction_refused` - Carrier refuses AI
9. `recorded_statement_requested` - Escalation triggered
10. `call_disconnected` - Mid-call disconnect
11. `invalid_phone_number` - Bad number
12. `xai_websocket_failure` - WebSocket error
13. `telnyx_initiation_failure` - Telnyx API error
14. `hold_timeout` - Exceeded hold duration

## Supabase Setup

### Hosted Supabase

1. Create a new Supabase project
2. Run the migrations in `supabase/migrations/` in order
3. Copy your project URL and keys to `.env`

### Local Supabase

```bash
supabase start
supabase db reset  # Runs all migrations
```

### Row Level Security

All tables use RLS. Key policies:
- Users can only access missions for cases they have access to
- The voice worker uses the service role key (bypasses RLS)
- Mission creation requires an active user role
- Review actions require case access + active role

## Telnyx Setup

1. **Create a Telnyx account** at [telnyx.com](https://telnyx.com)
2. **Purchase a phone number** — this is your outbound caller ID
3. **Create an Outbound Voice Profile** — configure the number
4. **Create a SIP Connection** for xAI routing:
   - Connection type: Credentials-based or IP-based
   - Configure the SIP URI that xAI will use
5. **Set webhook URL** to `{VOICE_WORKER_BASE_URL}/webhooks/telnyx/calls`
6. **Copy these values** to your `.env`:
   - `TELNYX_API_KEY`
   - `TELNYX_PUBLIC_KEY` (for webhook verification)
   - `TELNYX_CONNECTION_ID`
   - `TELNYX_OUTBOUND_VOICE_PROFILE_ID`
   - `TELNYX_CALLER_ID_NUMBER` (E.164 format)
   - `TELNYX_SIP_CONNECTION_ID`

## xAI Voice Agent Setup

1. **Get API access** to xAI's Voice Agent API
2. **Register your SIP endpoint** (Direct SIP / BYO Trunk):
   - Register the Telnyx SIP trunk with xAI
   - Configure the phone number or SIP route
   - Set `origin: "byo_trunk"` in your configuration
3. **Configure the SIP webhook**:
   - URL: `{VOICE_WORKER_BASE_URL}/webhooks/xai/sip`
   - xAI will POST `realtime.call.incoming` events here
4. **Copy to `.env`**:
   - `XAI_API_KEY`
   - `XAI_SIP_PHONE_NUMBER_ID`
   - `XAI_SIP_WEBHOOK_SECRET` (for signature verification)
   - `XAI_REALTIME_URL` (default: `wss://api.x.ai/v1/realtime`)

### SIP Authentication

xAI supports:
- TLS for SIP signaling (required)
- Webhook signature verification via HMAC-SHA256
- Bearer token authentication on the realtime WebSocket

The voice worker validates:
- Telnyx webhook signatures using the public key
- xAI SIP webhook signatures using HMAC-SHA256
- Internal API calls using `VOICE_WORKER_INTERNAL_SECRET`

## Railway Deployment

### Web Application

```bash
# Create Railway project
railway init

# Deploy web service
railway up --service web
```

Configure environment variables in Railway dashboard:
- All `NEXT_PUBLIC_*` vars
- `SUPABASE_SERVICE_ROLE_KEY`
- `VOICE_WORKER_BASE_URL` (internal Railway URL)
- `VOICE_WORKER_INTERNAL_SECRET`

### Voice Worker

```bash
# Deploy voice worker service
railway up --service voice-worker
```

Configure environment variables:
- All Telnyx and xAI keys
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- `VOICE_WORKER_INTERNAL_SECRET` (same as web)
- `APP_BASE_URL` (public URL of web app)
- `VOICE_MODE=live` (for production)

### Networking

- The voice worker must be publicly accessible for webhooks
- Internal communication between web and voice worker uses Railway's private networking or a shared secret

## Approved Context Protection

The system protects case data through multiple layers:

1. **Field-level selection** — Users explicitly toggle each field
2. **Immutable snapshot** — Approved context is frozen at authorization time
3. **Server-side tools** — Grok can only access approved fields via `get_approved_case_field`
4. **No generic queries** — Grok has no database access
5. **Restricted field list** — SSN, banking, medical details are never available
6. **Audit logging** — Every field access is logged

## Adding a New Mission Type

1. Add the type to `MISSION_TYPES` in `packages/shared/src/types/mission-types.ts`
2. Create a template constant similar to `OPEN_INSURANCE_CLAIM_TEMPLATE`
3. Insert a seed row in `call_mission_templates`
4. Add any type-specific Grok tools in `apps/voice-worker/src/services/grok-tools.ts`
5. Add type-specific structured result fields if needed
6. Update the UI wizard to show the new template option

## Connecting the CaseDataAdapter

The `CaseDataAdapter` in `apps/web/src/lib/case-data-adapter.ts` maps between:
- Your existing `cases` table fields → approved context field values
- Call results → proposed case updates

To connect to your existing schema:
1. Update `getSuggestedCallContext()` to query your actual case fields
2. Update `applyApprovedUpdate()` to write to your actual tables
3. Map field keys to your column names in the adapter

## Known V1 Limitations

- No automatic retries — each call attempt requires explicit user authorization
- Single call at a time per case (no bulk/parallel calls)
- No recurring/scheduled calls
- No live human transfer
- No recording by default (compliance configuration required)
- One telephony provider (Telnyx)
- One AI provider (xAI Grok)
- No mobile app
- No automatic case updates — all require human review
- DTMF support depends on xAI Voice Agent capabilities
- Hold detection relies on audio analysis

## Troubleshooting

### SIP Issues

| Problem | Solution |
|---------|----------|
| No xAI webhook received | Verify SIP endpoint registration, check webhook URL is publicly accessible |
| SIP 403 Forbidden | Check SIP authentication credentials in Telnyx connection |
| Audio one-way | Verify SIP connection allows bidirectional media, check NAT/firewall |
| Call connects but no AI speech | Verify WebSocket connects and `session.update` is sent successfully |

### WebSocket Issues

| Problem | Solution |
|---------|----------|
| Connection refused | Verify `XAI_REALTIME_URL`, check API key is valid |
| Immediate disconnect | Check `session.update` payload format matches xAI docs |
| No transcript events | Verify `input_audio_transcription` is configured |
| Tool calls fail | Check tool schema matches xAI's expected format |

### Webhook Issues

| Problem | Solution |
|---------|----------|
| Signature verification fails | Ensure `TELNYX_PUBLIC_KEY` / `XAI_SIP_WEBHOOK_SECRET` are correct |
| Events arrive out of order | Status precedence system handles this — check logs |
| Duplicate events | Idempotency check via `external_event_id` prevents double-processing |

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| "Outside calling hours" | Destination timezone check failed | Verify timezone and configured hours |
| "Number is blocked" | Phone number in blocked list | Remove from blocked_phone_numbers table |
| "No active role" | User lacks case_tracker_user_roles entry | Add user role in Supabase |
| "Mission not in queued status" | Race condition or stale state | Refresh and retry |
