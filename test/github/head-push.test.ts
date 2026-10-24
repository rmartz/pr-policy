import { beforeEach, describe, expect, it, vi } from 'vitest';
import { github, transports } from './fake-github.js';

// GitHub is a boundary: both transports read the same raw API responses.
vi.mock('../../src/lib/github.js', async () => {
  const fake = await import('./fake-github.js');
  return { ghCall: fake.fakeGhCall, ...fake.fakeLabels };
});

const { gatherHeadPushedAt } = await import('../../src/github/head-push.js');

const EVENTS = 'repos/o/r/issues/7/events';
const SUITES = 'repos/o/r/commits/head1/check-suites';
const forcePush = (at: string) => ({ event: 'head_ref_force_pushed', created_at: at });
const suites = (...at: string[]) => ({ check_suites: at.map((created_at) => ({ created_at })) });

beforeEach(() => {
  github.reset();
});

describe.each(await transports())('gatherHeadPushedAt over %s', (_name, makeClient) => {
  const target = () => ({ repo: 'o/r', pr: 7, client: makeClient() });

  it('reads the head commit’s earliest check suite as its push time', async () => {
    github.responses.set(EVENTS, []);
    github.responses.set(SUITES, suites('2026-10-01T12:05:00Z', '2026-10-01T12:00:00Z'));
    expect(await gatherHeadPushedAt(target(), 'head1')).toBe('2026-10-01T12:00:00.000Z');
  });

  it('takes a force push later than the earliest suite, as when a head is pushed back', async () => {
    github.responses.set(EVENTS, [
      forcePush('2026-10-01T13:00:00Z'),
      forcePush('2026-10-01T14:00:00Z'),
    ]);
    github.responses.set(SUITES, suites('2026-10-01T12:00:00Z'));
    expect(await gatherHeadPushedAt(target(), 'head1')).toBe('2026-10-01T14:00:00.000Z');
  });

  it('ignores events other than a force push', async () => {
    github.responses.set(EVENTS, [{ event: 'labeled', created_at: '2026-10-01T15:00:00Z' }]);
    github.responses.set(SUITES, suites('2026-10-01T12:00:00Z'));
    expect(await gatherHeadPushedAt(target(), 'head1')).toBe('2026-10-01T12:00:00.000Z');
  });

  it('keeps the suite time when every force push came before it', async () => {
    github.responses.set(EVENTS, [forcePush('2026-10-01T11:00:00Z')]);
    github.responses.set(SUITES, suites('2026-10-01T12:00:00Z'));
    expect(await gatherHeadPushedAt(target(), 'head1')).toBe('2026-10-01T12:00:00.000Z');
  });

  it('falls back to the force push when the head has no check suite', async () => {
    github.responses.set(EVENTS, [forcePush('2026-10-01T11:00:00Z')]);
    github.responses.set(SUITES, suites());
    expect(await gatherHeadPushedAt(target(), 'head1')).toBe('2026-10-01T11:00:00.000Z');
  });

  it('is unknown when GitHub records neither', async () => {
    github.responses.set(EVENTS, []);
    github.responses.set(SUITES, suites());
    expect(await gatherHeadPushedAt(target(), 'head1')).toBeUndefined();
  });

  it('throws when the check suites cannot be read, rather than guessing', async () => {
    github.responses.set(EVENTS, []);
    await expect(gatherHeadPushedAt(target(), 'head1')).rejects.toThrow(`could not read ${SUITES}`);
  });

  it('throws when the PR events cannot be read', async () => {
    github.responses.set(SUITES, suites('2026-10-01T12:00:00Z'));
    await expect(gatherHeadPushedAt(target(), 'head1')).rejects.toThrow(`could not read ${EVENTS}`);
  });
});
