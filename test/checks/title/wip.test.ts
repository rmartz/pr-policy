import { describe, expect, it } from 'vitest';
import { decideTitle } from '../../../src/checks/title/index.js';
import type { PullRequestFacts } from '../../../src/policy.js';

function pr(title: string): PullRequestFacts {
  return {
    title,
    labels: [],
    changedFiles: [],
    workflowChanges: [],
    manifestChanges: [],
    signOffs: [],
  };
}

const findings = (title: string) => decideTitle(pr(title)).findings;

describe('decideTitle — [WIP] marker', () => {
  it.each(['feat: add a thing [WIP]', 'fix(cli): [wip] handle flags', 'chore: tidy [Wip]'])(
    'blocks `%s` and says to remove the marker',
    (title) => {
      const [finding, ...rest] = findings(title);
      expect(rest).toEqual([]);
      expect(finding?.effect).toBe('block');
      expect(finding?.message).toContain('[WIP]');
      expect(finding?.message).toContain('Remove');
    },
  );

  it('reports a leading marker as WIP, not as a broken Conventional Commit', () => {
    const messages = findings('[WIP] feat: add a thing').map((finding) => finding.message);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('[WIP]');
    expect(messages[0]).not.toContain('not a Conventional Commit');
  });

  it('still applies the other rules to the title without the marker', () => {
    const messages = findings('[WIP] chore!: drop node 18').map((finding) => finding.message);
    expect(messages).toHaveLength(2);
    expect(messages.some((message) => message.includes('[WIP]'))).toBe(true);
    expect(messages.some((message) => message.includes('`!` is only allowed'))).toBe(true);
  });

  it('still reports a broken title once the marker is gone', () => {
    const messages = findings('[WIP] add a thing').map((finding) => finding.message);
    expect(messages).toHaveLength(2);
    expect(messages.some((message) => message.includes('not a Conventional Commit'))).toBe(true);
  });

  it.each(['feat: add WIP tracking', 'feat: swipe to dismiss', 'fix: wip counter overflow'])(
    'ignores `%s`, which has no bracketed marker',
    (title) => {
      expect(findings(title)).toEqual([]);
    },
  );
});
