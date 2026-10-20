import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transport } from '../../src/lib/github.js';

// `gh` is a boundary: every call is answered from this table by its exact
// REST endpoint; an unlisted endpoint fails the way `gh` does (null).
const responses = new Map<string, string>();
const calls: string[] = [];
vi.mock('../../src/lib/github.js', () => ({
  ghCall: async (primary: Transport) => {
    const endpoint = primary.argv.find((arg) => arg.startsWith('repos/')) ?? '';
    calls.push(endpoint);
    return responses.get(endpoint) ?? null;
  },
  addLabels: vi.fn(),
  removeLabel: vi.fn(),
}));

const { gatherSignOffStatus } = await import('../../src/github/sign-off-status.js');
const { openPullRequestsAtHead } = await import('../../src/github/pull-request.js');

const target = { repo: 'o/r' };
const STATUSES = 'repos/o/r/commits/head1/statuses';
const line = (context: string, description: string, login: string | null, type = 'User') =>
  JSON.stringify({ context, state: 'success', description, login, type });

beforeEach(() => {
  responses.clear();
  calls.length = 0;
});

describe('gatherSignOffStatus', () => {
  it('takes the newest pr-lifecycle/sign-off status and looks up who posted it', async () => {
    responses.set(
      STATUSES,
      [
        line('pr-policy', 'All PR policy checks pass', 'github-actions[bot]', 'Bot'),
        line('pr-lifecycle/sign-off', 'v1 requirement=uat waiver=current', 'reed'),
        line('pr-lifecycle/sign-off', 'v1 requirement=none', 'reed'),
      ].join('\n'),
    );
    responses.set(
      'repos/o/r/collaborators/reed/permission',
      JSON.stringify({ role_name: 'admin' }),
    );
    expect(await gatherSignOffStatus(target, 'head1')).toEqual({
      state: 'success',
      description: 'v1 requirement=uat waiver=current',
      creator: { login: 'reed', type: 'User', permission: 'admin' },
    });
  });

  it('is absent when pr-lifecycle has posted nothing on the head', async () => {
    responses.set(STATUSES, line('pr-policy', 'pending', 'github-actions[bot]', 'Bot'));
    expect(await gatherSignOffStatus(target, 'head1')).toBeUndefined();
  });

  it('skips the permission lookup for a bot creator', async () => {
    responses.set(
      STATUSES,
      line('pr-lifecycle/sign-off', 'v1 requirement=none', 'github-actions[bot]', 'Bot'),
    );
    const status = await gatherSignOffStatus(target, 'head1');
    expect(status?.creator).toEqual({
      login: 'github-actions[bot]',
      type: 'Bot',
      permission: 'none',
    });
    expect(calls).toEqual([STATUSES]);
  });

  it('throws when the statuses cannot be read, rather than falling back', async () => {
    await expect(gatherSignOffStatus(target, 'head1')).rejects.toThrow(
      `could not read ${STATUSES}`,
    );
  });
});

describe('openPullRequestsAtHead', () => {
  const PULLS = 'repos/o/r/commits/head1/pulls';

  it('returns only open PRs whose head is still that SHA', async () => {
    responses.set(
      PULLS,
      [
        JSON.stringify({ number: 7, head: 'head1' }),
        JSON.stringify({ number: 8, head: 'head2' }), // moved on since
      ].join('\n'),
    );
    expect(await openPullRequestsAtHead(target, 'head1')).toEqual([7]);
  });

  it('throws when the lookup fails', async () => {
    await expect(openPullRequestsAtHead(target, 'head1')).rejects.toThrow(
      `could not read ${PULLS}`,
    );
  });
});
