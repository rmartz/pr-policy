import { describe, expect, it } from 'vitest';
import { decideBaseBranch } from '../../src/checks/base-branch.js';
import type { OpenPullRequest, PullRequestFacts } from '../../src/policy.js';

function pr(branch: string, headOf: OpenPullRequest[] = [], labels: string[] = []) {
  const facts: PullRequestFacts = {
    title: 'feat: add a thing',
    base: { branch, defaultBranch: 'main', headOf },
    labels,
    changedFiles: ['src/a.ts'],
    workflowChanges: [],
    manifestChanges: [],
    signOffs: [],
  };
  return facts;
}

const epic = (number: number): OpenPullRequest => ({ number, labels: ['Epic', 'UI'] });
const plain = (number: number): OpenPullRequest => ({ number, labels: ['UI'] });

const effects = (facts: PullRequestFacts) =>
  decideBaseBranch(facts).findings.map((finding) => finding.effect);

describe('decideBaseBranch', () => {
  it('passes any PR targeting the default branch', () => {
    expect(effects(pr('main'))).toEqual([]);
    expect(effects(pr('main', [], ['epic']))).toEqual([]);
  });

  it('passes a non-epic PR targeting an epic PR’s branch', () => {
    expect(effects(pr('feature/big', [epic(12)]))).toEqual([]);
  });

  it('matches the epic label regardless of case', () => {
    expect(effects(pr('feature/big', [{ number: 12, labels: ['EPIC'] }]))).toEqual([]);
  });

  it('holds an epic PR stacked on another epic until the parent merges', () => {
    const { findings } = decideBaseBranch(pr('feature/big', [epic(12)], ['epic']));
    expect(findings.map((finding) => finding.effect)).toEqual(['hold']);
    expect(findings[0]?.message).toContain('epic #12');
    expect(findings[0]?.message).toContain('once #12 merges');
  });

  it('holds a PR stacked on a non-epic PR until the parent merges', () => {
    const { findings } = decideBaseBranch(pr('fix/part-1', [plain(9)]));
    expect(findings.map((finding) => finding.effect)).toEqual(['hold']);
    expect(findings[0]?.message).toContain('#9, which is not an epic');
  });

  it('holds an epic stacked on a non-epic PR too', () => {
    expect(effects(pr('fix/part-1', [plain(9)], ['epic']))).toEqual(['hold']);
  });

  it('lets any epic among several PRs heading the branch accumulate', () => {
    expect(effects(pr('feature/big', [plain(9), epic(12)]))).toEqual([]);
  });

  it('blocks a non-default base that no open PR heads', () => {
    const { findings } = decideBaseBranch(pr('release/old'));
    expect(findings.map((finding) => finding.effect)).toEqual(['block']);
    expect(findings[0]?.message).toContain('Retarget it to `main`');
  });

  it('reports nothing when the base was not gathered', () => {
    const { base: _base, ...facts } = pr('release/old');
    expect(effects(facts)).toEqual([]);
  });

  it('never plans a label edit', () => {
    const result = decideBaseBranch(pr('fix/part-1', [plain(9)]));
    expect(result.labelsToAdd).toBeUndefined();
    expect(result.labelsToRemove).toBeUndefined();
  });
});
