import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '../src/evaluate.js';
import type { Finding, PolicyCheck, PullRequestFacts } from '../src/policy.js';
import { buildReport } from '../src/report.js';

const pr: PullRequestFacts = {
  title: 'feat: add a thing',
  labels: [],
  changedFiles: ['src/a.ts'],
  workflowChanges: [],
  manifestChanges: [],
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
  it('passes a well-titled PR that touches no workflow file', async () => {
    expect((await evaluatePolicy(pr)).outcome).toBe('success');
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
