import { describe, expect, it } from 'vitest';
import { decideMergeBlock } from '../../src/checks/merge-block.js';
import { BLOCKING_LABELS } from '../../src/contract.js';
import type { PullRequestFacts } from '../../src/policy.js';

function pr(labels: string[]): PullRequestFacts {
  return {
    title: 'feat: add a thing',
    labels,
    changedFiles: ['src/a.ts'],
    workflowChanges: [],
    manifestChanges: [],
    signOffs: [],
  };
}

const effects = (labels: string[]) =>
  decideMergeBlock(pr(labels)).findings.map((finding) => finding.effect);

describe('decideMergeBlock', () => {
  it.each(BLOCKING_LABELS)('holds a PR carrying `%s`', (label) => {
    expect(effects([label, 'UI'])).toEqual(['hold']);
  });

  it('holds, never blocks: only a person removing the label can clear it', () => {
    expect(effects(['do not merge'])).not.toContain('block');
  });

  it('reports nothing for a PR with no blocking label', () => {
    expect(effects(['approved', 'UI', 'blocked-by-design'])).toEqual([]);
  });

  it('matches regardless of case and separators', () => {
    for (const label of [
      'Do Not Merge',
      'do-not-merge',
      'DO_NOT_MERGE',
      'DNM',
      'Escalation-Needed',
    ]) {
      expect(effects([label])).toEqual(['hold']);
    }
  });

  it('names every blocking label in one finding, as spelled on the PR', () => {
    const { findings } = decideMergeBlock(pr(['Blocked', 'dnm', 'UI']));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain('`Blocked`, `dnm`');
    expect(findings[0]?.message).toContain('labels are removed');
  });

  it('never plans a label edit', () => {
    const result = decideMergeBlock(pr(['do not merge']));
    expect(result.labelsToAdd).toBeUndefined();
    expect(result.labelsToRemove).toBeUndefined();
  });
});
