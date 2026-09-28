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
}));

const { gatherSignOffs } = await import('../../src/github/sign-offs.js');

const target = { repo: 'o/r', pr: 7 };
const EVENTS = 'repos/o/r/issues/7/events';
const event = (label: string, login: string | null, type: string | null = 'User') =>
  JSON.stringify({ label, login, type });

beforeEach(() => {
  responses.clear();
  calls.length = 0;
});

describe('gatherSignOffs', () => {
  it('reads nothing when no sign-off label is on the PR', async () => {
    expect(await gatherSignOffs(target, ['UI', 'approved'])).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('attributes each label to its latest labeling and looks up that user', async () => {
    responses.set(
      EVENTS,
      [event('UAT passed', 'bot', 'Bot'), event('UI', 'x'), event('UAT passed', 'reed')].join('\n'),
    );
    responses.set(
      'repos/o/r/collaborators/reed/permission',
      JSON.stringify({ permission: 'write', role_name: 'maintain' }),
    );
    expect(await gatherSignOffs(target, ['UAT passed'])).toEqual([
      { label: 'UAT passed', appliedBy: { login: 'reed', type: 'User', permission: 'maintain' } },
    ]);
  });

  it('falls back to the legacy level for a custom role', async () => {
    responses.set(EVENTS, event('tested', 'reed'));
    responses.set(
      'repos/o/r/collaborators/reed/permission',
      JSON.stringify({ permission: 'admin', role_name: 'release-manager' }),
    );
    const [signOff] = await gatherSignOffs(target, ['tested']);
    expect(signOff?.appliedBy?.permission).toBe('admin');
  });

  it('treats a failed permission lookup (a non-collaborator 404) as none', async () => {
    responses.set(EVENTS, event('no UAT needed', 'stranger'));
    const [signOff] = await gatherSignOffs(target, ['no UAT needed']);
    expect(signOff?.appliedBy?.permission).toBe('none');
  });

  it('skips the permission lookup for a bot', async () => {
    responses.set(EVENTS, event('CI change approved', 'app[bot]', 'Bot'));
    const [signOff] = await gatherSignOffs(target, ['CI change approved']);
    expect(signOff?.appliedBy).toEqual({ login: 'app[bot]', type: 'Bot', permission: 'none' });
    expect(calls).toEqual([EVENTS]);
  });

  it('records no actor when no event names a live account', async () => {
    responses.set(EVENTS, event('UAT passed', null, null));
    expect(await gatherSignOffs(target, ['UAT passed', 'tested'])).toEqual([
      { label: 'UAT passed' },
      { label: 'tested' },
    ]);
  });

  it('throws when the label history cannot be read, rather than holding silently', async () => {
    await expect(gatherSignOffs(target, ['UAT passed'])).rejects.toThrow(
      'could not list label events of o/r#7',
    );
  });
});
