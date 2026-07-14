import { describe, it, expect } from 'vitest';
import { canTransitionStatus, isTerminalStatus, isActiveStatus } from '../utils/status-precedence';

describe('canTransitionStatus', () => {
  it('allows forward transitions', () => {
    expect(canTransitionStatus('draft', 'authorized')).toBe(true);
    expect(canTransitionStatus('authorized', 'queued')).toBe(true);
    expect(canTransitionStatus('queued', 'initiating')).toBe(true);
    expect(canTransitionStatus('initiating', 'dialing')).toBe(true);
    expect(canTransitionStatus('dialing', 'ringing')).toBe(true);
    expect(canTransitionStatus('ringing', 'answered')).toBe(true);
    expect(canTransitionStatus('answered', 'in_progress')).toBe(true);
    expect(canTransitionStatus('in_progress', 'completed')).toBe(true);
  });

  it('prevents backward transitions', () => {
    expect(canTransitionStatus('in_progress', 'dialing')).toBe(false);
    expect(canTransitionStatus('answered', 'ringing')).toBe(false);
    expect(canTransitionStatus('completed', 'in_progress')).toBe(false);
  });

  it('allows on_hold to in_progress', () => {
    expect(canTransitionStatus('on_hold', 'in_progress')).toBe(true);
  });

  it('prevents same-state transitions', () => {
    expect(canTransitionStatus('draft', 'draft')).toBe(false);
    expect(canTransitionStatus('in_progress', 'in_progress')).toBe(false);
  });

  it('allows terminal to review transitions', () => {
    expect(canTransitionStatus('completed', 'awaiting_review')).toBe(true);
    expect(canTransitionStatus('failed', 'awaiting_review')).toBe(true);
  });

  it('prevents terminal to active transitions', () => {
    expect(canTransitionStatus('completed', 'in_progress')).toBe(false);
    expect(canTransitionStatus('failed', 'dialing')).toBe(false);
  });
});

describe('isTerminalStatus', () => {
  it('identifies terminal statuses', () => {
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
  });

  it('rejects non-terminal statuses', () => {
    expect(isTerminalStatus('in_progress')).toBe(false);
    expect(isTerminalStatus('draft')).toBe(false);
    expect(isTerminalStatus('awaiting_review')).toBe(false);
  });
});

describe('isActiveStatus', () => {
  it('identifies active statuses', () => {
    expect(isActiveStatus('initiating')).toBe(true);
    expect(isActiveStatus('dialing')).toBe(true);
    expect(isActiveStatus('ringing')).toBe(true);
    expect(isActiveStatus('answered')).toBe(true);
    expect(isActiveStatus('in_progress')).toBe(true);
    expect(isActiveStatus('on_hold')).toBe(true);
  });

  it('rejects inactive statuses', () => {
    expect(isActiveStatus('draft')).toBe(false);
    expect(isActiveStatus('completed')).toBe(false);
    expect(isActiveStatus('awaiting_review')).toBe(false);
  });
});
