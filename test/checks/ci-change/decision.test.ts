import { describe, expect, it } from 'vitest';
import type { Classification } from '../../../src/checks/ci-change/classify.js';
import { decideCiChange } from '../../../src/checks/ci-change/index.js';
import { looseningIndicator } from '../../../src/checks/ci-change/indicators.js';
import { CI_APPROVAL_NEEDED_LABEL, CI_CHANGE_APPROVED_LABEL } from '../../../src/contract.js';
import type { LabelActor, SignOff } from '../../../src/policy.js';

const LOOSENING: Classification = {
  verdict: 'loosening',
  indicators: [
    looseningIndicator(
      'job-removed',
      '.github/workflows/ci.yml',
      'jobs.test',
      'Job `test` was removed.',
    ),
  ],
};
const TIGHTENING: Classification = { verdict: 'tightening', indicators: [] };
const NO_CHANGE: Classification = { verdict: 'no-change', indicators: [] };

const MAINTAINER: LabelActor = { login: 'reed', type: 'User', permission: 'admin' };

/** A PR carrying `labels`; `CI change approved` was applied by `approver`. */
const pr = (labels: string[], approver: LabelActor | undefined = MAINTAINER) => ({
  labels,
  signOffs: labels.includes(CI_CHANGE_APPROVED_LABEL)
    ? [{ label: CI_CHANGE_APPROVED_LABEL, appliedBy: approver } satisfies SignOff]
    : [],
});

const decide = (classification: Classification, labels: string[], approver?: LabelActor) =>
  decideCiChange(classification, pr(labels, approver));

const effects = (labels: string[], classification: Classification) =>
  decide(classification, labels).findings.map((finding) => finding.effect);

describe('decideCiChange — labels', () => {
  it('applies the gate label to an unlabelled loosening', () => {
    expect(decide(LOOSENING, ['DevOps']).labelsToAdd).toEqual([CI_APPROVAL_NEEDED_LABEL]);
  });

  it('does not re-apply a gate label the PR already carries', () => {
    expect(decide(LOOSENING, [CI_APPROVAL_NEEDED_LABEL]).labelsToAdd).toEqual([]);
  });

  it('removes a stale gate label once the loosening is gone and nobody has signed off', () => {
    expect(decide(TIGHTENING, [CI_APPROVAL_NEEDED_LABEL]).labelsToRemove).toEqual([
      CI_APPROVAL_NEEDED_LABEL,
    ]);
  });

  it('keeps the gate label once a human has signed off, as the audit record', () => {
    const labels = [CI_APPROVAL_NEEDED_LABEL, CI_CHANGE_APPROVED_LABEL];
    expect(decide(TIGHTENING, labels).labelsToRemove).toEqual([]);
  });

  it('never applies the human sign-off label', () => {
    for (const classification of [LOOSENING, TIGHTENING, NO_CHANGE]) {
      expect(decide(classification, []).labelsToAdd).not.toContain(CI_CHANGE_APPROVED_LABEL);
    }
  });
});

describe('decideCiChange — findings', () => {
  it('holds (never blocks) an unsigned loosening and lists every indicator', () => {
    const { findings } = decide(LOOSENING, []);
    expect(effects([], LOOSENING)).toContain('hold');
    expect(effects([], LOOSENING)).not.toContain('block');
    expect(findings.some((finding) => finding.message.includes('jobs.test'))).toBe(true);
  });

  it('releases the hold and headlines the sign-off once a human applies the label', () => {
    const labels = [CI_APPROVAL_NEEDED_LABEL, CI_CHANGE_APPROVED_LABEL];
    expect(effects(labels, LOOSENING)).not.toContain('hold');
    expect(decide(LOOSENING, labels).findings.find((f) => f.headline)?.message).toContain(
      'signed off',
    );
  });

  it('reports a tightening as information only', () => {
    expect(effects([], TIGHTENING)).toEqual(['info']);
  });

  it('reports nothing when no workflow file changed', () => {
    expect(decide(NO_CHANGE, []).findings).toEqual([]);
  });
});

describe('decideCiChange — who applied the sign-off', () => {
  const signed = [CI_APPROVAL_NEEDED_LABEL, CI_CHANGE_APPROVED_LABEL];

  it.each([
    ['a bot', { login: 'dependabot[bot]', type: 'Bot', permission: 'none' }, 'not a person'],
    ['a triage-only user', { login: 'helper', type: 'User', permission: 'triage' }, '`triage`'],
    ['nobody traceable', undefined, 'no labeling event'],
  ] as const)('keeps holding when %s applied it, and says why', (_who, approver, reason) => {
    const { findings } = decideCiChange(LOOSENING, {
      labels: signed,
      signOffs: [{ label: CI_CHANGE_APPROVED_LABEL, appliedBy: approver }],
    });
    expect(findings.map((finding) => finding.effect)).toContain('hold');
    expect(findings.some((finding) => finding.message.includes(reason))).toBe(true);
  });

  it('counts a write-permission user, such as an agent acting with their token', () => {
    const writer: LabelActor = { login: 'agent', type: 'User', permission: 'write' };
    expect(decide(LOOSENING, signed, writer).findings.map((f) => f.effect)).not.toContain('hold');
  });

  it('removes a stale gate label when the only sign-off is untrusted', () => {
    const bot: LabelActor = { login: 'x[bot]', type: 'Bot', permission: 'none' };
    expect(decide(TIGHTENING, signed, bot).labelsToRemove).toEqual([CI_APPROVAL_NEEDED_LABEL]);
  });
});
