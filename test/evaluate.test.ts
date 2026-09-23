import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '../src/evaluate.js';
import type { Finding, PolicyCheck, PullRequestFacts } from '../src/policy.js';
import { buildReport } from '../src/report.js';

const pr: PullRequestFacts = { title: 'feat: add a thing', labels: [], changedFiles: ['src/a.ts'] };

function stubCheck(name: string, findings: Finding[]): PolicyCheck {
  return { name, evaluate: async () => findings };
}

describe('buildReport', () => {
  it('is success with no findings', () => {
    const report = buildReport([]);
    expect(report.conclusion).toBe('success');
    expect(report.summary).toBe('No policy findings.');
  });

  it('stays success when every finding is non-blocking', () => {
    const report = buildReport([{ check: 'a', message: 'fyi', blocking: false }]);
    expect(report.conclusion).toBe('success');
    expect(report.summary).toContain('**a**: fyi');
  });

  it('is failure when any finding blocks, and counts only blocking findings', () => {
    const report = buildReport([
      { check: 'a', message: 'fyi', blocking: false },
      { check: 'b', message: 'bad title', blocking: true },
    ]);
    expect(report.conclusion).toBe('failure');
    expect(report.title).toBe('1 blocking policy finding');
  });
});

describe('evaluatePolicy', () => {
  it('passes with no registered checks', async () => {
    expect((await evaluatePolicy(pr)).conclusion).toBe('success');
  });

  it('folds every check into one report, in check order', async () => {
    const report = await evaluatePolicy(pr, [
      stubCheck('first', [{ check: 'first', message: 'one', blocking: false }]),
      stubCheck('second', [{ check: 'second', message: 'two', blocking: true }]),
    ]);
    expect(report.conclusion).toBe('failure');
    expect(report.findings.map((finding) => finding.check)).toEqual(['first', 'second']);
  });
});
