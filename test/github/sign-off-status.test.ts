import { beforeEach, describe, expect, it, vi } from 'vitest';
import { github, pages, transports } from './fake-github.js';

// GitHub is a boundary: both transports read the same raw API responses.
vi.mock('../../src/lib/github.js', async () => {
  const fake = await import('./fake-github.js');
  return { ghCall: fake.fakeGhCall, ...fake.fakeLabels };
});

const { gatherSignOffStatus } = await import('../../src/github/sign-off-status.js');

const STATUSES = 'repos/o/r/commits/head1/statuses';
const status = (context: string, description: string, login: string | null, type = 'User') => ({
  context,
  state: 'success',
  description,
  creator: login === null ? null : { login, type },
});

beforeEach(() => {
  github.reset();
});

describe.each(await transports())('gatherSignOffStatus over %s', (_name, makeClient) => {
  const target = () => ({ repo: 'o/r', client: makeClient() });

  it('takes the newest pr-lifecycle/sign-off status and looks up who posted it', async () => {
    github.responses.set(STATUSES, [
      status('pr-policy', 'All PR policy checks pass', 'github-actions[bot]', 'Bot'),
      status('pr-lifecycle/sign-off', 'v1 requirement=uat waiver=current', 'reed'),
      status('pr-lifecycle/sign-off', 'v1 requirement=none', 'reed'),
    ]);
    github.responses.set('repos/o/r/collaborators/reed/permission', { role_name: 'admin' });
    expect(await gatherSignOffStatus(target(), 'head1')).toEqual({
      state: 'success',
      description: 'v1 requirement=uat waiver=current',
      creator: { login: 'reed', type: 'User', permission: 'admin' },
    });
  });

  it('finds the status on a later page', async () => {
    github.responses.set(
      STATUSES,
      pages(
        [status('pr-policy', 'pending', 'github-actions[bot]', 'Bot')],
        [status('pr-lifecycle/sign-off', 'v1 requirement=none', 'app[bot]', 'Bot')],
      ),
    );
    const found = await gatherSignOffStatus(target(), 'head1');
    expect(found?.description).toBe('v1 requirement=none');
  });

  it('is absent when pr-lifecycle has posted nothing on the head', async () => {
    github.responses.set(STATUSES, [status('pr-policy', 'pending', 'github-actions[bot]', 'Bot')]);
    expect(await gatherSignOffStatus(target(), 'head1')).toBeUndefined();
  });

  it('records no creator for a status posted by a deleted account', async () => {
    github.responses.set(STATUSES, [status('pr-lifecycle/sign-off', 'v1 requirement=none', null)]);
    expect(await gatherSignOffStatus(target(), 'head1')).toEqual({
      state: 'success',
      description: 'v1 requirement=none',
    });
  });

  it('skips the permission lookup for a bot creator', async () => {
    github.responses.set(STATUSES, [
      status('pr-lifecycle/sign-off', 'v1 requirement=none', 'github-actions[bot]', 'Bot'),
    ]);
    const found = await gatherSignOffStatus(target(), 'head1');
    expect(found?.creator).toEqual({
      login: 'github-actions[bot]',
      type: 'Bot',
      permission: 'none',
    });
    expect(github.reads).toEqual([STATUSES]);
  });

  it('throws when the statuses cannot be read, rather than falling back', async () => {
    await expect(gatherSignOffStatus(target(), 'head1')).rejects.toThrow(
      `could not read ${STATUSES}`,
    );
  });
});
