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

// Through the entry point: pr-lifecycle loads the config the same way.
const { loadRepoConfig } = await import('../../src/index.js');

const target = { repo: 'o/r' };
const LISTING = 'repos/o/r/contents/.github?ref=main';
const FILE = 'repos/o/r/contents/.github/pr-policy.yml?ref=main';

beforeEach(() => {
  responses.clear();
  calls.length = 0;
});

describe('loadRepoConfig', () => {
  it('reads the file at the base branch, never another ref', async () => {
    responses.set(LISTING, ['workflows', 'pr-policy.yml'].join('\n'));
    responses.set(FILE, 'uat: off\n');
    expect(await loadRepoConfig(target, 'main')).toEqual({ config: { uat: 'off' }, problems: [] });
    expect(calls).toEqual([LISTING, FILE]);
  });

  it('uses the defaults when the base branch has no file', async () => {
    responses.set(LISTING, ['workflows', 'dependabot.yml'].join('\n'));
    expect(await loadRepoConfig(target, 'main')).toEqual({ config: { uat: 'on' }, problems: [] });
    expect(calls).toEqual([LISTING]);
  });

  it('encodes a slash in the base branch name', async () => {
    responses.set('repos/o/r/contents/.github?ref=release%2F2', 'workflows');
    expect((await loadRepoConfig(target, 'release/2')).config.uat).toBe('on');
  });

  it('throws when the directory cannot be listed, rather than using the defaults', async () => {
    await expect(loadRepoConfig(target, 'main')).rejects.toThrow('could not list .github/ at main');
  });

  it('throws when a listed file cannot be read', async () => {
    responses.set(LISTING, 'pr-policy.yml');
    await expect(loadRepoConfig(target, 'main')).rejects.toThrow(
      'could not read .github/pr-policy.yml at main',
    );
  });

  it('fails closed on a bad file and reports it', async () => {
    responses.set(LISTING, 'pr-policy.yml');
    responses.set(FILE, 'uat: maybe\n');
    const { config, problems } = await loadRepoConfig(target, 'main');
    expect(config.uat).toBe('on');
    expect(problems).toHaveLength(1);
  });
});
