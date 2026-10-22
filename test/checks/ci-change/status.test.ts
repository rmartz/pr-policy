import { describe, expect, it } from 'vitest';
import type { Classification } from '../../../src/checks/ci-change/classify.js';
import { decideCiChange } from '../../../src/checks/ci-change/index.js';
import { looseningIndicator } from '../../../src/checks/ci-change/indicators.js';
import { CI_APPROVAL_NEEDED_LABEL, CI_CHANGE_APPROVED_LABEL } from '../../../src/contract.js';
import type { CommitStatus, LabelActor, SignOff } from '../../../src/policy.js';

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
const NO_CHANGE: Classification = { verdict: 'no-change', indicators: [] };

const MAINTAINER: LabelActor = { login: 'reed', type: 'User', permission: 'admin' };
const approved: SignOff = { label: CI_CHANGE_APPROVED_LABEL, appliedBy: MAINTAINER };

const lifecycle = (description: string, overrides: Partial<CommitStatus> = {}): CommitStatus => ({
  state: 'success',
  description,
  creator: MAINTAINER,
  ...overrides,
});

const facts = (signOffStatus: CommitStatus | undefined, signOffs: SignOff[] = []) => ({
  labels: signOffs.map((signOff) => signOff.label),
  signOffs,
  ...(signOffStatus === undefined ? {} : { signOffStatus }),
});

describe('decideCiChange — gates on the pr-lifecycle/sign-off status', () => {
  it('holds a ci head that needs a CI sign-off, even with no workflow loosening', () => {
    // e.g. a `ci:` PR changing scripts/**: pr-lifecycle asks; this check can't see why.
    const { findings } = decideCiChange(NO_CHANGE, facts(lifecycle('v1 requirement=ci')));
    expect(findings.map((finding) => finding.effect)).toEqual(['hold']);
    expect(findings[0]?.message).toContain('classified this `ci` PR');
  });

  it('passes a ci head once a trusted person applied CI change approved', () => {
    const { findings } = decideCiChange(
      NO_CHANGE,
      facts(lifecycle('v1 requirement=ci'), [approved]),
    );
    expect(findings.map((finding) => finding.effect)).toEqual(['info']);
    expect(findings[0]?.headline).toBe(true);
  });

  it('needs CI change approved for a loosening bundled into a uat head', () => {
    const status = lifecycle('v1 requirement=uat waiver=absent loosening=yes');
    const { findings } = decideCiChange(LOOSENING, facts(status));
    expect(findings.map((finding) => finding.effect)).toEqual(['hold', 'info']);
    expect(findings[0]?.message).toContain('loosens CI');
  });

  it('asks for nothing when the status needs no CI sign-off, whatever this check sees', () => {
    expect(decideCiChange(LOOSENING, facts(lifecycle('v1 requirement=none'))).findings).toEqual([]);
  });

  it('edits no label once a status is present: pr-lifecycle writes CI approval needed', () => {
    const result = decideCiChange(LOOSENING, facts(lifecycle('v1 requirement=ci loosening=yes')));
    expect(result.labelsToAdd ?? []).toEqual([]);
    expect(result.labelsToRemove ?? []).toEqual([]);
  });

  it('keeps an untrusted CI change approved from counting, and says why', () => {
    const bot: SignOff = {
      label: CI_CHANGE_APPROVED_LABEL,
      appliedBy: { login: 'app[bot]', type: 'Bot', permission: 'none' },
    };
    const { findings } = decideCiChange(NO_CHANGE, facts(lifecycle('v1 requirement=ci'), [bot]));
    expect(findings.map((finding) => finding.effect)).toEqual(['hold', 'info']);
  });
});

describe('decideCiChange — falls back without a usable status', () => {
  it('classifies the workflow diff itself and reconciles the label when no status is present', () => {
    const result = decideCiChange(LOOSENING, facts(undefined));
    expect(result.findings[0]?.effect).toBe('hold');
    expect(result.labelsToAdd).toEqual([CI_APPROVAL_NEEDED_LABEL]);
  });

  it('ignores a status from an untrusted creator: falls back, labels and all, and says so', () => {
    const forged = lifecycle('v1 requirement=none', {
      creator: { login: 'github-actions[bot]', type: 'Bot', permission: 'none' },
    });
    const result = decideCiChange(LOOSENING, facts(forged));
    expect(result.findings[0]?.effect).toBe('hold');
    expect(result.labelsToAdd).toEqual([CI_APPROVAL_NEEDED_LABEL]);
    expect(result.findings.at(-1)?.message).toContain('Ignored the `pr-lifecycle/sign-off` status');
  });

  it('falls back on a trusted status it cannot use (the uat check holds on that)', () => {
    expect(
      decideCiChange(LOOSENING, facts(lifecycle('v2 requirement=none'))).findings[0]?.effect,
    ).toBe('hold');
  });
});
