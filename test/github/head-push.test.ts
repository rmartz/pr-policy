import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transport } from '../../src/lib/github.js';

// `gh` is a boundary: every call is answered from this table by its exact
// REST endpoint; an unlisted endpoint fails the way `gh` does (null).
const responses = new Map<string, string>();
vi.mock('../../src/lib/github.js', () => ({
  ghCall: async (primary: Transport) => {
    const endpoint = primary.argv.find((arg) => arg.startsWith('repos/')) ?? '';
    return responses.get(endpoint) ?? null;
  },
}));

const { gatherHeadPushedAt } = await import('../../src/github/head-push.js');

const target = { repo: 'o/r', pr: 7 };
const EVENTS = 'repos/o/r/issues/7/events';
const SUITES = 'repos/o/r/commits/head1/check-suites';

beforeEach(() => {
  responses.clear();
});

describe('gatherHeadPushedAt', () => {
  it('reads the head commit’s earliest check suite as its push time', async () => {
    responses.set(EVENTS, '');
    responses.set(SUITES, ['2026-10-01T12:05:00Z', '2026-10-01T12:00:00Z'].join('\n'));
    expect(await gatherHeadPushedAt(target, 'head1')).toBe('2026-10-01T12:00:00.000Z');
  });

  it('takes a force push later than the earliest suite, as when a head is pushed back', async () => {
    responses.set(EVENTS, ['2026-10-01T13:00:00Z', '2026-10-01T14:00:00Z'].join('\n'));
    responses.set(SUITES, '2026-10-01T12:00:00Z');
    expect(await gatherHeadPushedAt(target, 'head1')).toBe('2026-10-01T14:00:00.000Z');
  });

  it('keeps the suite time when every force push came before it', async () => {
    responses.set(EVENTS, '2026-10-01T11:00:00Z');
    responses.set(SUITES, '2026-10-01T12:00:00Z');
    expect(await gatherHeadPushedAt(target, 'head1')).toBe('2026-10-01T12:00:00.000Z');
  });

  it('falls back to the force push when the head has no check suite', async () => {
    responses.set(EVENTS, '2026-10-01T11:00:00Z');
    responses.set(SUITES, '');
    expect(await gatherHeadPushedAt(target, 'head1')).toBe('2026-10-01T11:00:00.000Z');
  });

  it('is unknown when GitHub records neither', async () => {
    responses.set(EVENTS, '');
    responses.set(SUITES, '');
    expect(await gatherHeadPushedAt(target, 'head1')).toBeUndefined();
  });

  it('throws when the check suites cannot be read, rather than guessing', async () => {
    responses.set(EVENTS, '');
    await expect(gatherHeadPushedAt(target, 'head1')).rejects.toThrow(`could not read ${SUITES}`);
  });

  it('throws when the PR events cannot be read', async () => {
    responses.set(SUITES, '2026-10-01T12:00:00Z');
    await expect(gatherHeadPushedAt(target, 'head1')).rejects.toThrow(`could not read ${EVENTS}`);
  });
});
