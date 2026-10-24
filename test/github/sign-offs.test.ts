import { beforeEach, describe, expect, it, vi } from 'vitest';
import { github, transports } from './fake-github.js';

// GitHub is a boundary: both transports read the same raw API responses.
vi.mock('../../src/lib/github.js', async () => {
  const fake = await import('./fake-github.js');
  return { ghCall: fake.fakeGhCall, ...fake.fakeLabels };
});

const { gatherSignOffs } = await import('../../src/github/sign-offs.js');

const EVENTS = 'repos/o/r/issues/7/events';
const event = (
  label: string,
  login: string | null,
  type = 'User',
  at = '2026-10-01T10:00:00Z',
) => ({
  event: 'labeled',
  label: { name: label },
  actor: login === null ? null : { login, type },
  created_at: at,
});

beforeEach(() => {
  github.reset();
});

describe.each(await transports())('gatherSignOffs over %s', (_name, makeClient) => {
  const target = () => ({ repo: 'o/r', pr: 7, client: makeClient() });

  it('reads nothing when no sign-off label is on the PR', async () => {
    expect(await gatherSignOffs(target(), ['UI', 'approved'])).toEqual([]);
    expect(github.reads).toEqual([]);
  });

  it('attributes each label to its latest labeling and looks up that user', async () => {
    github.responses.set(EVENTS, [
      event('UAT passed', 'bot', 'Bot'),
      event('UI', 'x'),
      event('UAT passed', 'reed'),
    ]);
    github.responses.set('repos/o/r/collaborators/reed/permission', {
      permission: 'write',
      role_name: 'maintain',
    });
    expect(await gatherSignOffs(target(), ['UAT passed'])).toEqual([
      {
        label: 'UAT passed',
        appliedBy: { login: 'reed', type: 'User', permission: 'maintain' },
        appliedAt: '2026-10-01T10:00:00Z',
      },
    ]);
  });

  it('ignores events other than labeling', async () => {
    github.responses.set(EVENTS, [
      event('UAT passed', 'reed', 'User', '2026-10-01T10:00:00Z'),
      { ...event('UAT passed', 'other', 'User', '2026-10-03T10:00:00Z'), event: 'unlabeled' },
    ]);
    const [signOff] = await gatherSignOffs(target(), ['UAT passed']);
    expect(signOff?.appliedAt).toBe('2026-10-01T10:00:00Z');
  });

  it('records when the latest labeling happened', async () => {
    github.responses.set(EVENTS, [
      event('UAT passed', 'reed', 'User', '2026-10-01T10:00:00Z'),
      event('UAT passed', 'reed', 'User', '2026-10-02T10:00:00Z'),
    ]);
    const [signOff] = await gatherSignOffs(target(), ['UAT passed']);
    expect(signOff?.appliedAt).toBe('2026-10-02T10:00:00Z');
  });

  it('falls back to the legacy level for a custom role', async () => {
    github.responses.set(EVENTS, [event('tested', 'reed')]);
    github.responses.set('repos/o/r/collaborators/reed/permission', {
      permission: 'admin',
      role_name: 'release-manager',
    });
    const [signOff] = await gatherSignOffs(target(), ['tested']);
    expect(signOff?.appliedBy?.permission).toBe('admin');
  });

  it('treats a failed permission lookup (a non-collaborator 404) as none', async () => {
    github.responses.set(EVENTS, [event('no UAT needed', 'stranger')]);
    const [signOff] = await gatherSignOffs(target(), ['no UAT needed']);
    expect(signOff?.appliedBy?.permission).toBe('none');
  });

  it('skips the permission lookup for a bot', async () => {
    github.responses.set(EVENTS, [event('CI change approved', 'app[bot]', 'Bot')]);
    const [signOff] = await gatherSignOffs(target(), ['CI change approved']);
    expect(signOff?.appliedBy).toEqual({ login: 'app[bot]', type: 'Bot', permission: 'none' });
    expect(github.reads).toEqual([EVENTS]);
  });

  it('records no actor when no event names a live account', async () => {
    github.responses.set(EVENTS, [event('UAT passed', null)]);
    expect(await gatherSignOffs(target(), ['UAT passed', 'tested'])).toEqual([
      { label: 'UAT passed', appliedAt: '2026-10-01T10:00:00Z' },
      { label: 'tested' },
    ]);
  });

  it('throws when the label history cannot be read, rather than holding silently', async () => {
    await expect(gatherSignOffs(target(), ['UAT passed'])).rejects.toThrow(
      'could not list label events of o/r#7',
    );
  });
});
