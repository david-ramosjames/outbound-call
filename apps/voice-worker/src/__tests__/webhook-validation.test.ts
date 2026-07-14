import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

function verifyXaiWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex')
  );
}

describe('xAI Webhook Signature Verification', () => {
  const secret = 'test-webhook-secret';

  it('accepts valid signatures', () => {
    const payload = JSON.stringify({ type: 'realtime.call.incoming', call_id: 'test-123' });
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    expect(verifyXaiWebhookSignature(payload, signature, secret)).toBe(true);
  });

  it('rejects invalid signatures', () => {
    const payload = JSON.stringify({ type: 'realtime.call.incoming', call_id: 'test-123' });
    const badSignature = crypto.createHmac('sha256', 'wrong-secret').update(payload).digest('hex');
    expect(verifyXaiWebhookSignature(payload, badSignature, secret)).toBe(false);
  });

  it('rejects tampered payloads', () => {
    const payload = JSON.stringify({ type: 'realtime.call.incoming', call_id: 'test-123' });
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const tampered = JSON.stringify({ type: 'realtime.call.incoming', call_id: 'hacked' });
    const tamperedSig = crypto.createHmac('sha256', secret).update(tampered).digest('hex');
    expect(verifyXaiWebhookSignature(payload, tamperedSig, secret)).toBe(false);
  });
});

describe('Duplicate Webhook Handling', () => {
  const processedEvents = new Set<string>();

  function isAlreadyProcessed(source: string, externalEventId: string): boolean {
    const key = `${source}:${externalEventId}`;
    if (processedEvents.has(key)) return true;
    processedEvents.add(key);
    return false;
  }

  it('processes first event', () => {
    expect(isAlreadyProcessed('telnyx', 'evt-001')).toBe(false);
  });

  it('rejects duplicate event', () => {
    expect(isAlreadyProcessed('telnyx', 'evt-001')).toBe(true);
  });

  it('processes different event from same source', () => {
    expect(isAlreadyProcessed('telnyx', 'evt-002')).toBe(false);
  });

  it('processes same event ID from different source', () => {
    expect(isAlreadyProcessed('xai', 'evt-001')).toBe(false);
  });
});

describe('Out-of-Order Event Handling', () => {
  const STATUS_PRECEDENCE: Record<string, number> = {
    draft: 0, authorized: 1, queued: 2, initiating: 3,
    dialing: 4, ringing: 5, answered: 6, in_progress: 7,
    on_hold: 8, completed: 10, failed: 10, cancelled: 10,
    needs_human_follow_up: 11, awaiting_review: 12, reviewed: 13,
  };

  function shouldUpdateStatus(current: string, incoming: string): boolean {
    const currentP = STATUS_PRECEDENCE[current] ?? -1;
    const incomingP = STATUS_PRECEDENCE[incoming] ?? -1;
    if (current === 'on_hold' && incoming === 'in_progress') return true;
    return incomingP > currentP;
  }

  it('allows forward progression', () => {
    expect(shouldUpdateStatus('dialing', 'ringing')).toBe(true);
    expect(shouldUpdateStatus('ringing', 'answered')).toBe(true);
  });

  it('rejects backward progression from out-of-order webhook', () => {
    expect(shouldUpdateStatus('answered', 'ringing')).toBe(false);
    expect(shouldUpdateStatus('in_progress', 'dialing')).toBe(false);
  });

  it('handles hold/resume correctly', () => {
    expect(shouldUpdateStatus('in_progress', 'on_hold')).toBe(true);
    expect(shouldUpdateStatus('on_hold', 'in_progress')).toBe(true);
  });
});
