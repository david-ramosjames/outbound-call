import { describe, it, expect, vi } from 'vitest';
import { newIntakeState } from '@outbound-call/shared';

vi.mock('../config.js', () => ({ config: { SLACK_BOT_TOKEN: 'xoxb-default', APP_BASE_URL: 'https://app.test' } }));
vi.mock('../lib/supabase.js', () => ({ supabase: {} }));

const { findThreadForPhones, formatSlackSummary, formatSlackTranscript, slackTokenFor } = await import('../inbound/slack.js');

describe('inbound Slack posting', () => {
  it('threads under the earliest post that mentions the caller, matching on the last 10 digits', () => {
    const messages = [
      { ts: '300.1', text: 'New text from (512) 555-1234' },
      { ts: '200.1', thread_ts: '100.1', text: 'reply mentioning +15125551234' },
      { ts: '150.1', text: 'Missed call from 737-555-0000' },
    ];
    expect(findThreadForPhones(messages, ['+15125551234'])).toBe('100.1');
    expect(findThreadForPhones(messages, ['5125559999'])).toBeNull();
  });

  it('finds phone numbers inside attachments and blocks (Quo router posts)', () => {
    const messages = [
      { ts: '10.1', text: '', attachments: [{ fields: [{ title: 'From', value: '+1 512.555.1234' }] }] },
      { ts: '20.1', blocks: [{ text: { text: 'Lead 5125550000' } }] },
    ];
    expect(findThreadForPhones(messages, ['(512) 555-1234'])).toBe('10.1');
    expect(findThreadForPhones(messages, ['+15125550000'])).toBe('20.1');
  });

  it('uses a per-line token when set, else the default', () => {
    expect(slackTokenFor('ramos-james')).toBe('xoxb-default');
    process.env.SLACK_BOT_TOKEN_TRUCKING_CHICAS = 'xoxb-tc';
    expect(slackTokenFor('trucking-chicas')).toBe('xoxb-tc');
    delete process.env.SLACK_BOT_TOKEN_TRUCKING_CHICAS;
  });

  it('summary includes the firm, caller number, and a link to the call', () => {
    const state = newIntakeState({ intakeId: 'i1', callId: 'c1', callerIdNumber: '+15125551234' });
    state.facts = { caller_type: 'new_potential_client', caller_name: 'Ana <Lopez>' };
    const text = formatSlackSummary({ firmName: 'Ramos James Law', state, callerNumber: '+15125551234', durationSeconds: 125, callUrl: 'https://app.test/inbound/calls/c1' });
    expect(text).toContain('Ramos James Law');
    expect(text).toContain('(512) 555-1234');
    expect(text).toContain('2m 5s');
    expect(text).toContain('<https://app.test/inbound/calls/c1|Open call>');
    expect(text).toContain('Ana &lt;Lopez&gt;');
  });

  it('splits long transcripts into Slack-sized replies', () => {
    const segments = Array.from({ length: 200 }, (_, i) => ({ speaker: i % 2 ? 'caller' : 'agent', text: `line ${i} `.repeat(10) }));
    const chunks = formatSlackTranscript(segments);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toMatch(/^\*Transcript \(1\/\d+\)\*/);
    for (const c of chunks) expect(c.length).toBeLessThan(3700);
    expect(formatSlackTranscript([])).toEqual([]);
  });
});
