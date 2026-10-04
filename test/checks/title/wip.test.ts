import { describe, expect, it } from 'vitest';
import { decideTitle } from '../../../src/checks/title/index.js';
import { stripWipMarker } from '../../../src/checks/title/wip.js';
import type { PullRequestFacts } from '../../../src/policy.js';

function makePullRequest(title: string, draft?: boolean): PullRequestFacts {
  const pr: PullRequestFacts = {
    title,
    labels: [],
    changedFiles: [],
    workflowChanges: [],
    manifestChanges: [],
    signOffs: [],
  };
  if (draft !== undefined) pr.draft = draft;
  return pr;
}

const messages = (title: string, draft?: boolean) =>
  decideTitle(makePullRequest(title, draft)).findings.map((finding) => finding.message);

describe('stripWipMarker', () => {
  it.each([
    ['[WIP] feat: add a thing', 'feat: add a thing'],
    ['[wip]feat: add a thing', 'feat: add a thing'],
    ['feat: add a thing [Wip]', 'feat: add a thing'],
    ['WIP: feat: add a thing', 'feat: add a thing'],
    ['WIP feat: add a thing', 'feat: add a thing'],
    ['feat: add a thing WIP', 'feat: add a thing'],
    ['[WIP] feat: add a thing [WIP]', 'feat: add a thing'],
  ])('strips the end marker from `%s`', (title, stripped) => {
    expect(stripWipMarker(title)).toEqual({ title: stripped, marked: true });
  });

  it.each([
    'feat(title): block a title that still carries a [WIP] marker',
    'feat: add WIP tracking',
    'fix: wip counter overflow',
    'feat: swipe to dismiss',
    'feat: track wip',
    'WIPE: feat: x',
  ])('leaves `%s` unmarked', (title) => {
    expect(stripWipMarker(title)).toEqual({ title, marked: false });
  });
});

describe('decideTitle — WIP marker implies draft', () => {
  it('blocks a WIP title on a PR that is ready for review', () => {
    const [finding, ...rest] = decideTitle(
      makePullRequest('[WIP] feat: add a thing', false),
    ).findings;
    expect(rest).toEqual([]);
    expect(finding?.effect).toBe('block');
    expect(finding?.message).toContain('Convert the PR to a draft');
  });

  it('accepts a WIP title on a draft', () => {
    expect(messages('[WIP] feat: add a thing', true)).toEqual([]);
  });

  it('accepts a draft without a WIP title', () => {
    expect(messages('feat: add a thing', true)).toEqual([]);
  });

  it('accepts a plain title on a PR that is ready for review', () => {
    expect(messages('feat: add a thing', false)).toEqual([]);
  });

  it('blocks a WIP title when the draft status is unknown', () => {
    expect(messages('feat: add a thing [WIP]')).toEqual([expect.stringContaining("isn't a draft")]);
  });

  it('reports a leading marker as WIP, not as a broken Conventional Commit', () => {
    const found = messages('[WIP] feat: add a thing', false);
    expect(found).toHaveLength(1);
    expect(found[0]).not.toContain('not a Conventional Commit');
  });

  it('still applies the other rules to a WIP draft, without the marker', () => {
    expect(messages('[WIP] chore!: drop node 18', true)).toEqual([
      expect.stringContaining('`!` is only allowed'),
    ]);
  });

  it('still reports a broken title once the marker is gone', () => {
    expect(messages('[WIP] add a thing', true)).toEqual([
      expect.stringContaining('not a Conventional Commit'),
    ]);
  });
});
