import { beforeEach, describe, expect, it, vi } from 'vitest';
import { github, transports } from './fake-github.js';

// GitHub is a boundary: both transports read the same raw API responses.
vi.mock('../../src/lib/github.js', async () => {
  const fake = await import('./fake-github.js');
  return { ghCall: fake.fakeGhCall, ...fake.fakeLabels };
});

const { applyAutoMergeArm, gatherAutoMerge } = await import('../../src/github/auto-merge.js');
const { changeFingerprint } = await import('../../src/checks/auto-merge/fingerprint.js');
const { markerBody } = await import('../../src/checks/auto-merge/marker.js');

const ARMED = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const EVENTS = 'repos/o/r/issues/7/events';
const COMMENTS = 'repos/o/r/issues/7/comments';

const person = { login: 'someone', type: 'User' };
const view = (enabledBy: { login: string; type: string } | null = person) => ({
  auto_merge: { enabled_by: enabledBy },
  head: { sha: HEAD },
  base: { ref: 'main' },
});

function comment(
  id: number,
  body: string,
  at: string,
  extra: { type?: string; updated_at?: string } = {},
) {
  return {
    id,
    body,
    user: { login: 'github-actions[bot]', type: extra.type ?? 'Bot' },
    created_at: at,
    updated_at: extra.updated_at ?? at,
  };
}

const enabled = (at: string, event = 'auto_squash_enabled') => ({ event, created_at: at });
const files = (line: string) => ({
  files: [{ filename: 'src/a.ts', status: 'modified', sha: 'x', patch: `@@ -1 +1 @@\n${line}` }],
});

beforeEach(() => {
  github.reset();
});

describe.each(await transports())('gatherAutoMerge over %s', (_name, makeClient) => {
  const target = () => ({ repo: 'o/r', pr: 7, client: makeClient() });

  it('is absent, reading nothing, while auto-merge is off', async () => {
    const off = { ...view(), auto_merge: null };
    expect(await gatherAutoMerge(target(), off)).toBeUndefined();
    expect(github.reads).toEqual([]);
  });

  it('reads nothing more for a bot-enabled request, which is exempt', async () => {
    const bot = { login: 'merge-bot[bot]', type: 'Bot' };
    expect(await gatherAutoMerge(target(), view(bot))).toEqual({ enabledBy: bot, headSha: HEAD });
    expect(github.reads).toEqual([]);
  });

  it('reads an unknown enabler as a person, so the guard still applies', async () => {
    github.responses.set(EVENTS, []);
    github.responses.set(COMMENTS, []);
    const facts = await gatherAutoMerge(target(), view(null));
    expect(facts?.enabledBy.type).toBe('unknown');
  });

  it('takes the latest enable event, whatever the merge method', async () => {
    github.responses.set(EVENTS, [
      enabled('2026-11-01T10:00:00Z', 'auto_merge_enabled'),
      { event: 'auto_merge_disabled', created_at: '2026-11-01T10:30:00Z' },
      enabled('2026-11-01T11:00:00Z', 'auto_rebase_enabled'),
      { event: 'labeled', created_at: '2026-11-01T12:00:00Z' },
    ]);
    github.responses.set(COMMENTS, []);
    const facts = await gatherAutoMerge(target(), view());
    expect(facts?.enabledAt).toBe('2026-11-01T11:00:00Z');
    expect(facts?.armed).toBeUndefined();
  });

  it('trusts only the latest unedited marker a bot wrote', async () => {
    github.responses.set(EVENTS, [enabled('2026-11-01T11:00:00Z')]);
    github.responses.set(COMMENTS, [
      comment(1, markerBody(HEAD), '2026-11-01T11:00:05Z'),
      // A person can't author as a bot, so their copy of a marker is ignored.
      comment(2, markerBody(ARMED), '2026-11-01T11:10:00Z', { type: 'User' }),
      // A bot marker edited since it was posted is ignored.
      comment(3, markerBody(ARMED), '2026-11-01T11:20:00Z', { updated_at: '2026-11-01T11:30:00Z' }),
      comment(4, 'LGTM', '2026-11-01T11:40:00Z'),
    ]);
    const facts = await gatherAutoMerge(target(), view());
    expect(facts?.armed).toEqual({ sha: HEAD, at: '2026-11-01T11:00:05Z' });
    // The record names the head, so no change is compared.
    expect(facts?.armedChange).toBeUndefined();
    expect(github.reads.some((path) => path.includes('/compare/'))).toBe(false);
  });

  it('fingerprints both heads from their merge bases when the head has moved', async () => {
    github.responses.set(EVENTS, [enabled('2026-11-01T11:00:00Z')]);
    github.responses.set(COMMENTS, [comment(1, markerBody(ARMED), '2026-11-01T11:00:05Z')]);
    github.responses.set(`repos/o/r/compare/main...${ARMED}`, files('+one'));
    github.responses.set(`repos/o/r/compare/main...${HEAD}`, files('+two'));
    const facts = await gatherAutoMerge(target(), view());
    expect(facts?.armedChange).toBe(changeFingerprint(files('+one').files));
    expect(facts?.headChange).toBe(changeFingerprint(files('+two').files));
  });

  it('leaves a change absent when its comparison cannot be read', async () => {
    github.responses.set(EVENTS, [enabled('2026-11-01T11:00:00Z')]);
    github.responses.set(COMMENTS, [comment(1, markerBody(ARMED), '2026-11-01T11:00:05Z')]);
    github.responses.set(`repos/o/r/compare/main...${HEAD}`, files('+two'));
    const facts = await gatherAutoMerge(target(), view());
    expect(facts?.armedChange).toBeUndefined();
    expect(facts?.headChange).toBeDefined();
  });

  it('skips the comparison for a record older than the latest enable', async () => {
    github.responses.set(EVENTS, [enabled('2026-11-01T12:00:00Z')]);
    github.responses.set(COMMENTS, [comment(1, markerBody(ARMED), '2026-11-01T11:00:05Z')]);
    const facts = await gatherAutoMerge(target(), view());
    expect(facts?.armed?.sha).toBe(ARMED);
    expect(github.reads.some((path) => path.includes('/compare/'))).toBe(false);
  });

  it('throws when the events or comments cannot be read, rather than guessing', async () => {
    github.responses.set(COMMENTS, []);
    await expect(gatherAutoMerge(target(), view())).rejects.toThrow(`could not read ${EVENTS}`);
    github.responses.set(EVENTS, []);
    github.responses.delete(COMMENTS);
    await expect(gatherAutoMerge(target(), view())).rejects.toThrow(`could not read ${COMMENTS}`);
  });
});

describe.each(await transports())('applyAutoMergeArm over %s', (_name, makeClient) => {
  const target = () => ({ repo: 'o/r', pr: 7, client: makeClient() });

  it('posts a new marker, then deletes the bot markers it supersedes', async () => {
    github.responses.set(COMMENTS, [
      comment(1, markerBody(ARMED), '2026-11-01T11:00:05Z'),
      comment(2, markerBody(ARMED), '2026-11-01T11:10:00Z', { type: 'User' }),
      comment(3, 'LGTM', '2026-11-01T11:20:00Z'),
    ]);
    github.writeResponse = { id: 9 };
    await applyAutoMergeArm(target(), HEAD);
    expect(github.writes).toEqual([
      { method: 'POST', path: COMMENTS, body: { body: markerBody(HEAD) } },
      { method: 'DELETE', path: 'repos/o/r/issues/comments/1', body: undefined },
    ]);
  });

  it('deletes nothing when the new marker could not be posted', async () => {
    github.responses.set(COMMENTS, [comment(1, markerBody(ARMED), '2026-11-01T11:00:05Z')]);
    github.failingWrites.add(COMMENTS);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await applyAutoMergeArm(target(), HEAD);
    expect(github.writes.map((write) => write.method)).toEqual(['POST']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
