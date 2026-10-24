import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Finding } from '../../src/policy.js';
import { github, transports } from './fake-github.js';

// GitHub is a boundary: both transports write to the same fake API.
vi.mock('../../src/lib/github.js', async () => {
  const fake = await import('./fake-github.js');
  return { ghCall: fake.fakeGhCall, ...fake.fakeLabels };
});

const { checkStatuses, postCheckStatuses } = await import('../../src/github/check-statuses.js');

const finding = (check: string, effect: Finding['effect'], message: string): Finding => ({
  check,
  effect,
  message,
});

beforeEach(() => {
  github.reset();
});

describe('checkStatuses', () => {
  it('passes a check with no gating finding', () => {
    expect(checkStatuses([{ name: 'title' }], [])).toEqual([
      { check: 'title', state: 'success', description: 'Passed' },
    ]);
  });

  it('fails a check on any block, led by the blocking finding', () => {
    const findings = [finding('title', 'hold', 'waiting'), finding('title', 'block', 'bad type')];
    expect(checkStatuses([{ name: 'title' }], findings)).toEqual([
      { check: 'title', state: 'failure', description: 'bad type (+1 more)' },
    ]);
  });

  it('holds a check on a hold with no block', () => {
    const findings = [finding('uat', 'hold', 'needs UAT passed')];
    expect(checkStatuses([{ name: 'uat' }], findings)[0]?.state).toBe('pending');
  });

  it('describes a passing check by its headline', () => {
    const findings = [
      { ...finding('ci-change', 'info', 'CI loosening signed off'), headline: true },
    ];
    expect(checkStatuses([{ name: 'ci-change' }], findings)[0]?.description).toBe(
      'CI loosening signed off',
    );
  });

  it("ignores another check's findings", () => {
    const findings = [finding('uat', 'block', 'nope')];
    expect(checkStatuses([{ name: 'title' }], findings)[0]?.state).toBe('success');
  });

  it('truncates a description to the 140 characters GitHub accepts', () => {
    const findings = [finding('title', 'block', 'x'.repeat(200))];
    expect(checkStatuses([{ name: 'title' }], findings)[0]?.description).toHaveLength(140);
  });
});

describe.each(await transports())('postCheckStatuses over %s', (_name, makeClient) => {
  const target = () => ({ repo: 'o/r', client: makeClient() });
  const statuses = [
    { check: 'title', state: 'success', description: 'Passed' },
    { check: 'uat', state: 'pending', description: 'waiting' },
  ] as const;

  it('posts one status per check under the context prefix', async () => {
    const ok = await postCheckStatuses(target(), 'sha1', statuses, {
      context: 'pr-policy (app)',
      targetUrl: 'https://example/run',
    });
    expect([ok, github.writes.map(({ body }) => body)]).toEqual([
      true,
      [
        {
          state: 'success',
          context: 'pr-policy (app) / title',
          description: 'Passed',
          target_url: 'https://example/run',
        },
        {
          state: 'pending',
          context: 'pr-policy (app) / uat',
          description: 'waiting',
          target_url: 'https://example/run',
        },
      ],
    ]);
  });

  it('defaults the prefix to pr-policy and omits an absent link', async () => {
    await postCheckStatuses(target(), 'sha1', statuses.slice(0, 1));
    expect(github.writes[0]?.body).toEqual({
      state: 'success',
      context: 'pr-policy / title',
      description: 'Passed',
    });
  });

  it('stops at the first failed post and reports it', async () => {
    github.failingWrites.add('repos/o/r/statuses/sha1');
    const ok = await postCheckStatuses(target(), 'sha1', statuses);
    expect([ok, github.writes.length]).toEqual([false, 1]);
  });
});
