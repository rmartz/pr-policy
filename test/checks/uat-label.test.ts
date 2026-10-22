import { describe, expect, it } from 'vitest';
import { selectChecks } from '../../src/checks/index.js';
import { decideUatLabel } from '../../src/checks/uat-label.js';
import { evaluatePolicy } from '../../src/evaluate.js';
import type { LabelActor, PullRequestFacts } from '../../src/policy.js';

const BOT: LabelActor = { login: 'github-actions[bot]', type: 'Bot', permission: 'none' };

/** A code PR (never trivial) carrying `labels`, each applied by `appliedBy`. */
function pr(labels: string[], appliedBy: LabelActor = BOT): PullRequestFacts {
  return {
    title: 'feat: add a page',
    labels,
    changedFiles: ['src/page.tsx'],
    workflowChanges: [],
    manifestChanges: [],
    signOffs: labels.map((label) => ({ label, appliedBy })),
  };
}

const effects = (facts: PullRequestFacts) =>
  decideUatLabel(facts).findings.map((finding) => finding.effect);

describe('decideUatLabel — presence', () => {
  it('holds a PR with no UAT label, pending rather than red, naming the labels', () => {
    const [finding] = decideUatLabel(pr(['DevOps'])).findings;
    expect(finding?.effect).toBe('hold');
    for (const label of ['no UAT needed', 'UAT pending', 'UAT ready', 'UAT passed']) {
      expect(finding?.message).toContain(`\`${label}\``);
    }
  });

  it.each(['no UAT needed', 'UAT pending', 'UAT ready', 'UAT passed', 'tested', 'ready for UAT'])(
    'is satisfied by `%s`',
    (label) => {
      expect(effects(pr([label]))).toEqual(['info']);
    },
  );

  it('counts a label whatever its case', () => {
    expect(effects(pr(['uat PENDING']))).toEqual(['info']);
  });

  it('counts a label a bot applied: presence trusts any actor', () => {
    expect(effects(pr(['UAT pending'], BOT))).toEqual(['info']);
  });

  it('is not satisfied by a different label that merely mentions UAT', () => {
    expect(effects(pr(['UAT', 'needs UAT']))).toEqual(['hold']);
  });
});

describe('uat-label — opt-in, and never relaxes the UAT rule', () => {
  it('is off by default: the suite never runs it', async () => {
    expect(selectChecks().map((check) => check.name)).not.toContain('uat-label');
    const report = await evaluatePolicy(pr([]), selectChecks());
    expect(report.findings.map((finding) => finding.check)).not.toContain('uat-label');
  });

  it('runs just before dependabot when requested', () => {
    const names = selectChecks({ requireUatLabel: true }).map((check) => check.name);
    expect(names.slice(-3)).toEqual(['uat', 'uat-label', 'dependabot']);
  });

  it('still runs when skipUat drops the UAT gate', () => {
    const names = selectChecks({ requireUatLabel: true, skipUat: true }).map((check) => check.name);
    expect(names).toContain('uat-label');
    expect(names).not.toContain('uat');
  });

  it('holds a PR with no UAT label even where the UAT rule would pass it', async () => {
    const docsOnly = { ...pr([]), changedFiles: ['README.md'] };
    const report = await evaluatePolicy(docsOnly, selectChecks({ requireUatLabel: true }));
    expect(report.outcome).toBe('pending');
    expect(report.findings.filter((f) => f.effect === 'hold').map((f) => f.check)).toEqual([
      'uat-label',
    ]);
  });

  it.each(['UAT pending', 'UAT ready'])(
    'leaves a PR that needs UAT held with only `%s`: presence passes, UAT does not',
    async (label) => {
      const report = await evaluatePolicy(pr([label]), selectChecks({ requireUatLabel: true }));
      expect(report.outcome).toBe('pending');
      expect(report.findings.filter((f) => f.effect === 'hold').map((f) => f.check)).toEqual([
        'uat',
      ]);
    },
  );

  it('does not let a bot-applied UAT passed pass the UAT rule', async () => {
    const report = await evaluatePolicy(
      pr(['UAT passed']),
      selectChecks({ requireUatLabel: true }),
    );
    expect(report.findings.filter((f) => f.effect === 'hold').map((f) => f.check)).toEqual(['uat']);
  });
});
