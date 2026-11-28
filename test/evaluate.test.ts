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
    expect(report.labelsToAdd).toEqual(['UAT needed']);
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

  it('carries the auto-merge arm a check asked for, and none otherwise', async () => {
    const arming: PolicyCheck = {
      name: 'arming',
      evaluate: async () => ({ findings: [], autoMergeArm: 'abc' }),
    };
    expect((await evaluatePolicy(pr, [stubCheck('first', []), arming])).autoMergeArm).toBe('abc');
    expect(await evaluatePolicy(pr, [stubCheck('first', [])])).not.toHaveProperty('autoMergeArm');
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
      'auto-merge',
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

  it('never touches `UAT needed` with the UAT gate skipped', async () => {
    const report = await evaluatePolicy(
      { ...pr, labels: ['UAT needed'] },
      selectChecks({ skipUat: true }),
    );
    expect(report.labelsToAdd).toEqual([]);
    expect(report.labelsToRemove).toEqual([]);
  });
});

describe('evaluatePolicy — Dependabot PRs with the UAT gate on', () => {
  // bot-automerge merges these unreviewed, and nothing labels them, so each has
  // to pass every check, `uat` included, with no labels at all.
  const manifest = (dependencies: Record<string, string>) =>
    JSON.stringify({ name: 'app', scripts: { dev: 'next dev' }, dependencies });
  const workflow = (checkout: string) =>
    `on: pull_request\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${checkout}\n      - run: pnpm test\n`;
  const dependabot = (facts: Partial<PullRequestFacts>): PullRequestFacts => ({
    ...pr,
    author: { login: 'dependabot[bot]', type: 'Bot' },
    labels: [],
    ...facts,
  });

  it('passes an npm production bump', async () => {
    const facts = dependabot({
      title: 'fix(deps): bump next from 16.0.1 to 16.0.2',
      body: 'Bumps [next](https://github.com/vercel/next.js) from 16.0.1 to 16.0.2.',
      changedFiles: ['package.json', 'pnpm-lock.yaml'],
      manifestChanges: [
        {
          path: 'package.json',
          baseText: manifest({ next: '^16.0.1' }),
          headText: manifest({ next: '^16.0.2' }),
        },
      ],
    });
    const report = await evaluatePolicy(facts, selectChecks());
    expect(report.outcome).toBe('success');
    expect(report.labelsToAdd).toEqual([]);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        check: 'uat',
        message: 'No UAT needed: the PR changes only dependencies.',
      }),
    );
  });

  it('passes a GitHub Actions pin bump', async () => {
    const facts = dependabot({
      title: 'chore(deps): bump actions/checkout from 4 to 5',
      body: 'Bumps [actions/checkout](https://github.com/actions/checkout) from 4 to 5.',
      changedFiles: ['.github/workflows/ci.yml'],
      workflowChanges: [
        { path: '.github/workflows/ci.yml', baseText: workflow('v4'), headText: workflow('v5') },
      ],
    });
    const report = await evaluatePolicy(facts, selectChecks());
    expect(report.outcome).toBe('success');
    expect(report.labelsToAdd).toEqual([]);
    expect(report.findings).toContainEqual(
      expect.objectContaining({ check: 'uat', message: 'No UAT needed: the PR changes only ci.' }),
    );
  });
});
