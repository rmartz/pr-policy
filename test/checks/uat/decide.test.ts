import { describe, expect, it } from 'vitest';
import { decideUat } from '../../../src/checks/uat/index.js';
import type { LabelActor, PullRequestFacts } from '../../../src/policy.js';

const MAINTAINER: LabelActor = { login: 'reed', type: 'User', permission: 'maintain' };

function pr(overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
  return {
    title: 'feat: add a thing',
    labels: [],
    changedFiles: ['src/a.ts'],
    workflowChanges: [],
    manifestChanges: [],
    signOffs: [],
    ...overrides,
  };
}

/** A code PR carrying `label`, last applied by `appliedBy` (nobody when undefined). */
const labelledBy = (label: string, appliedBy: LabelActor | undefined) =>
  pr({ labels: [label, 'UI'], signOffs: [{ label, appliedBy }] });

const effects = (facts: PullRequestFacts) =>
  decideUat(facts).findings.map((finding) => finding.effect);

describe('decideUat — holds by default', () => {
  it('holds a code change with no UAT label — a missing label is never "not required"', () => {
    expect(effects(pr())).toEqual(['hold']);
  });

  it('holds, never blocks: waiting on a person is not a problem the author can fix', () => {
    expect(effects(pr())).not.toContain('block');
  });
});

describe('decideUat — trivial PRs pass without a label', () => {
  it('passes a docs-only PR and names why', () => {
    const { findings } = decideUat(pr({ changedFiles: ['README.md', 'docs/a.md'] }));
    expect(findings.map((finding) => finding.effect)).toEqual(['info']);
    expect(findings[0]?.message).toContain('docs');
  });

  it('passes a PR mixing exempt categories', () => {
    const facts = pr({ changedFiles: ['docs/a.md', 'test/a.test.ts', 'LICENSE'] });
    expect(decideUat(facts).findings[0]?.message).toContain('docs, tests, metadata');
  });
});

describe('decideUat — sign-off labels', () => {
  it.each(['UAT passed', 'tested', 'no UAT needed'])('passes on a trusted `%s`', (label) => {
    const { findings } = decideUat(labelledBy(label, MAINTAINER));
    expect(findings.map((finding) => finding.effect)).toEqual(['info']);
    expect(findings[0]?.headline).toBe(true);
    expect(findings[0]?.message).toContain(`\`${label}\` by \`reed\``);
  });

  it.each([
    ['a GitHub App', { login: 'app[bot]', type: 'Bot', permission: 'none' }, 'not a person'],
    ['a triage-only user', { login: 'helper', type: 'User', permission: 'triage' }, '`triage`'],
    ['a read-only user', { login: 'fan', type: 'User', permission: 'read' }, '`read`'],
    ['nobody traceable', undefined, 'no labeling event'],
  ] as const)('keeps holding when %s applied the label, and says why', (_who, actor, reason) => {
    const { findings } = decideUat(labelledBy('UAT passed', actor));
    expect(findings.map((finding) => finding.effect)).toEqual(['hold', 'info']);
    expect(findings[1]?.message).toContain(reason);
  });

  it('passes when any one of several sign-offs is trusted', () => {
    const bot: LabelActor = { login: 'app[bot]', type: 'Bot', permission: 'none' };
    const facts = pr({
      labels: ['tested', 'no UAT needed'],
      signOffs: [
        { label: 'tested', appliedBy: bot },
        { label: 'no UAT needed', appliedBy: MAINTAINER },
      ],
    });
    expect(effects(facts)).toEqual(['info']);
  });

  it('ignores provenance for a label that is no longer on the PR', () => {
    const facts = pr({ signOffs: [{ label: 'UAT passed', appliedBy: MAINTAINER }] });
    expect(effects(facts)).toEqual(['hold']);
  });
});
