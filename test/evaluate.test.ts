import { describe, expect, it } from 'vitest';
import { CHECKS, selectChecks } from '../src/checks/index.js';
import { evaluatePolicy } from '../src/evaluate.js';
import type { Finding, PolicyCheck, PullRequestFacts } from '../src/policy.js';
import { buildReport } from '../src/report.js';

const pr: PullRequestFacts = {
  title: 'feat: add a thing',
  labels: [],
  changedFiles: ['src/a.ts'],
  workflowChanges: [],
  manifestChanges: [],
  signOffs: [],
};

function stubCheck(name: string, findings: Finding[], labelsToAdd: string[] = []): PolicyCheck {
  return { name, evaluate: async () => ({ findings, labelsToAdd }) };
}

const info: Finding = { check: 'a', message: 'fyi', effect: 'info' };
const hold: Finding = { check: 'b', message: 'waiting on a human', effect: 'hold' };
const block: Finding = { check: 'c', message: 'bad title', effect: 'block' };

describe('buildReport', () => {
  it('is success with no findings', () => {
    const report = buildReport([]);
    expect(report.outcome).toBe('success');
    expect(report.summary).toBe('No policy findings.');
  });

  it('stays success when every finding is informational', () => {
    const report = buildReport([info]);
    expect(report.outcome).toBe('success');
    expect(report.summary).toContain('**a**: fyi');
  });

  it('titles a success with its headline finding when there is one', () => {
    const report = buildReport([info, { ...info, message: 'signed off', headline: true }]);
    expect(report.title).toBe('signed off');
  });

  it('is pending, not failure, when the only gate is a hold', () => {
    const report = buildReport([info, hold]);
    expect(report.outcome).toBe('pending');
    expect(report.title).toBe('Waiting on 1 human sign-off');
  });

  it('is failure when anything blocks, even alongside a hold', () => {
    const report = buildReport([hold, block]);
    expect(report.outcome).toBe('failure');
    expect(report.title).toBe('1 blocking policy finding');
  });
});

describe('evaluatePolicy', () => {
  it('holds a well-titled code change until UAT is signed off', async () => {
    const report = await evaluatePolicy(pr);
    expect(report.outcome).toBe('pending');
    expect(report.findings.map((finding) => finding.check)).toEqual(['uat']);
  });

  it('holds a PR carrying a blocking label, even one that would otherwise pass', async () => {
    const report = await evaluatePolicy(
      { ...pr, labels: ['do not merge'] },
      selectChecks({ skipUat: true }),
    );
    expect(report.outcome).toBe('pending');
    expect(report.findings.map((finding) => finding.check)).toEqual(['merge-block']);
  });

  it('passes a well-titled docs-only PR outright', async () => {
    expect((await evaluatePolicy({ ...pr, changedFiles: ['README.md'] })).outcome).toBe('success');
  });

  it('folds every check into one report, in check order', async () => {
    const report = await evaluatePolicy(pr, [
      stubCheck('first', [{ ...info, check: 'first' }]),
      stubCheck('second', [{ ...block, check: 'second' }]),
    ]);
    expect(report.outcome).toBe('failure');
    expect(report.findings.map((finding) => finding.check)).toEqual(['first', 'second']);
  });

  it('collects the label edits every check planned', async () => {
    const report = await evaluatePolicy(pr, [stubCheck('first', [], ['owned label'])]);
    expect(report.labelsToAdd).toEqual(['owned label']);
    expect(report.labelsToRemove).toEqual([]);
  });
});

describe('selectChecks', () => {
  it('runs every check by default', () => {
    expect(selectChecks()).toEqual(CHECKS);
    expect(selectChecks({ skipUat: false })).toEqual(CHECKS);
  });

  it('drops only the UAT gate when skipUat is set', () => {
    expect(selectChecks({ skipUat: true }).map((check) => check.name)).toEqual([
      'merge-block',
      'base-branch',
      'title',
      'ci-change',
      'dependabot',
    ]);
  });

  it('passes a well-titled code change outright with the UAT gate skipped', async () => {
    const report = await evaluatePolicy(pr, selectChecks({ skipUat: true }));
    expect(report.outcome).toBe('success');
    expect(report.findings).toEqual([]);
  });
});

describe('selectChecks — sign-off status creators', () => {
  const fromApp = (description: string): PullRequestFacts => ({
    ...pr,
    signOffStatus: {
      state: 'success',
      description,
      creator: { login: 'rmartz-merge-bot[bot]', type: 'Bot', permission: 'none' },
    },
  });
  const creators = { signOffStatusCreators: ['rmartz-merge-bot[bot]'] };

  it('lets the UAT check trust a status from a named App', async () => {
    const report = await evaluatePolicy(fromApp('v1 requirement=none'), selectChecks(creators));
    expect(report.outcome).toBe('success');
  });

  it('lets the CI-change check trust a status from a named App', async () => {
    const report = await evaluatePolicy(fromApp('v1 requirement=ci'), selectChecks(creators));
    expect(report.findings.map((finding) => `${finding.check}:${finding.effect}`)).toContain(
      'ci-change:hold',
    );
    expect(report.findings.map((finding) => finding.check)).not.toContain('title');
  });

  it('ignores the same App status when the caller names no App, and falls back', async () => {
    // A code change the fallback holds stays held; the status can't open the gate.
    const report = await evaluatePolicy(fromApp('v1 requirement=none'), selectChecks());
    expect(report.outcome).toBe('pending');
    expect(report.findings.map((finding) => finding.message).join('\n')).toContain(
      'Ignored the `pr-lifecycle/sign-off` status on this head, because it was posted by `rmartz-merge-bot[bot]`',
    );
  });

  it('passes a trivial PR on the fallback despite an untrusted App status', async () => {
    const trivial = { ...fromApp('v1 requirement=uat waiver=absent'), changedFiles: ['docs/a.md'] };
    expect((await evaluatePolicy(trivial, selectChecks())).outcome).toBe('success');
  });

  it('keeps human sign-off labels on people only, whatever Apps are named', async () => {
    const facts: PullRequestFacts = {
      ...fromApp('v1 requirement=uat waiver=current'),
      labels: ['no UAT needed'],
      signOffs: [
        {
          label: 'no UAT needed',
          appliedBy: { login: 'rmartz-merge-bot[bot]', type: 'Bot', permission: 'none' },
        },
      ],
    };
    const report = await evaluatePolicy(facts, selectChecks(creators));
    expect(report.outcome).toBe('pending');
  });

  it('refuses github-actions[bot] as a creator', () => {
    expect(() => selectChecks({ signOffStatusCreators: ['github-actions[bot]'] })).toThrow(
      'any workflow in the repo can post as it',
    );
  });

  it('keeps skipUat working alongside named creators', () => {
    const names = selectChecks({ ...creators, skipUat: true }).map((check) => check.name);
    expect(names).not.toContain('uat');
    expect(names).toContain('ci-change');
  });
});
