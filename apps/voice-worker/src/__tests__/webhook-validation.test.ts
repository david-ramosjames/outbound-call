import { describe, it, expect } from 'vitest';
import crypto from 'crypto';

function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
  authToken: string
): boolean {
  const sortedKeys = Object.keys(params).sort();
  const dataString = sortedKeys.reduce((acc, key) => acc + key + params[key], url);

  const computed = crypto
    .createHmac('sha1', authToken)
    .update(dataString)
    .digest('base64');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computed)
  );
}

describe('Twilio Webhook Signature Verification', () => {
  const authToken = 'test-auth-token-12345';
  const url = 'https://voice.example.com/webhooks/twilio/calls';

  it('accepts valid signatures', () => {
    const params = { CallSid: 'CA123', CallStatus: 'ringing', From: '+15551234567' };
    const sortedKeys = Object.keys(params).sort();
    const dataString = sortedKeys.reduce((acc, key) => acc + key + params[key as keyof typeof params], url);
    const signature = crypto.createHmac('sha1', authToken).update(dataString).digest('base64');

    expect(validateTwilioSignature(url, params, signature, authToken)).toBe(true);
  });

  it('rejects invalid signatures', () => {
    const params = { CallSid: 'CA123', CallStatus: 'ringing', From: '+15551234567' };
    const badSignature = crypto.createHmac('sha1', 'wrong-token').update('bad').digest('base64');

    expect(validateTwilioSignature(url, params, badSignature, authToken)).toBe(false);
  });

  it('rejects tampered parameters', () => {
    const params = { CallSid: 'CA123', CallStatus: 'ringing', From: '+15551234567' };
    const sortedKeys = Object.keys(params).sort();
    const dataString = sortedKeys.reduce((acc, key) => acc + key + params[key as keyof typeof params], url);
    const signature = crypto.createHmac('sha1', authToken).update(dataString).digest('base64');

    const tampered = { ...params, CallStatus: 'completed' };
    expect(validateTwilioSignature(url, tampered, signature, authToken)).toBe(false);
  });
});

describe('xAI Webhook Signature Verification', () => {
  const secret = 'test-webhook-secret';

  function verifyXaiWebhookSignature(
    payload: string,
    signature: string,
    webhookSecret: string
  ): boolean {
    const expected = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex')
    );
  }

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
    expect(isAlreadyProcessed('twilio', 'evt-001')).toBe(false);
  });

  it('rejects duplicate event', () => {
    expect(isAlreadyProcessed('twilio', 'evt-001')).toBe(true);
  });

  it('processes different event from same source', () => {
    expect(isAlreadyProcessed('twilio', 'evt-002')).toBe(false);
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
