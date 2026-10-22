import { describe, expect, it } from 'vitest';
import { decideUat } from '../../../src/checks/uat/index.js';
import type { CommitStatus, LabelActor, PullRequestFacts, SignOff } from '../../../src/policy.js';

const MAINTAINER: LabelActor = { login: 'reed', type: 'User', permission: 'maintain' };
const PUSHED_AT = '2026-10-01T12:00:00Z';
const AFTER_PUSH = '2026-10-01T12:30:00Z';

const lifecycle = (description: string, overrides: Partial<CommitStatus> = {}): CommitStatus => ({
  state: 'success',
  description,
  creator: { login: 'reed', type: 'User', permission: 'admin' },
  ...overrides,
});

/** A code PR (never trivial) with pr-lifecycle's status and the given sign-offs. */
function pr(signOffStatus: CommitStatus | undefined, signOffs: SignOff[] = []): PullRequestFacts {
  return {
    title: 'feat: add a page',
    labels: signOffs.map((signOff) => signOff.label),
    changedFiles: ['src/page.tsx'],
    workflowChanges: [],
    manifestChanges: [],
    signOffs,
    headPushedAt: PUSHED_AT,
    ...(signOffStatus === undefined ? {} : { signOffStatus }),
  };
}

const effects = (facts: PullRequestFacts) =>
  decideUat(facts).findings.map((finding) => finding.effect);

const waiver: SignOff = { label: 'no UAT needed', appliedBy: MAINTAINER };
const tested: SignOff = { label: 'UAT passed', appliedBy: MAINTAINER, appliedAt: AFTER_PUSH };

describe('decideUat — gates on the pr-lifecycle/sign-off status', () => {
  it('passes a code PR that pr-lifecycle classifies as needing no sign-off', () => {
    expect(effects(pr(lifecycle('v1 requirement=none')))).toEqual(['info']);
  });

  it('adds no UAT hold when the head needs a CI sign-off instead', () => {
    const { findings } = decideUat(pr(lifecycle('v1 requirement=ci')));
    expect(findings.map((finding) => finding.effect)).toEqual(['info']);
    expect(findings[0]?.message).toContain('CI sign-off');
  });

  it('holds a head that needs UAT and has no sign-off', () => {
    expect(effects(pr(lifecycle('v1 requirement=uat waiver=absent')))).toEqual(['hold']);
  });

  it('passes a head that needs UAT on a trusted, current UAT passed', () => {
    expect(effects(pr(lifecycle('v1 requirement=uat waiver=absent'), [tested]))).toEqual(['info']);
  });

  it('passes a trusted no UAT needed that pr-lifecycle reports as current', () => {
    expect(effects(pr(lifecycle('v1 requirement=uat waiver=current'), [waiver]))).toEqual(['info']);
  });

  it.each(['stale', 'absent'])(
    'holds a trusted no UAT needed when pr-lifecycle reports the waiver %s',
    (state) => {
      const { findings } = decideUat(pr(lifecycle(`v1 requirement=uat waiver=${state}`), [waiver]));
      expect(findings.map((finding) => finding.effect)).toEqual(['hold', 'info']);
      expect(findings[1]?.message).toContain(`waiver as \`${state}\``);
    },
  );

  it('still binds UAT passed to the head under a status', () => {
    const old: SignOff = { ...tested, appliedAt: '2026-10-01T11:00:00Z' };
    expect(effects(pr(lifecycle('v1 requirement=uat waiver=absent'), [old]))).toEqual([
      'hold',
      'info',
    ]);
  });

  it('never reads pr-lifecycle labels: UAT ready on the PR changes nothing', () => {
    const facts = { ...pr(lifecycle('v1 requirement=uat waiver=absent')), labels: ['UAT ready'] };
    expect(effects(facts)).toEqual(['hold']);
  });
});

const untrustedApp = (description: string) =>
  lifecycle(description, {
    creator: { login: 'rmartz-pr-lifecycle[bot]', type: 'Bot', permission: 'none' },
  });

describe('decideUat — an untrusted status is ignored, and the fallback applies', () => {
  it('passes a trivial PR the fallback passes, and names the creator and the fix', () => {
    const facts = {
      ...pr(untrustedApp('v1 requirement=uat waiver=absent')),
      changedFiles: ['docs/a.md'],
    };
    const { findings } = decideUat(facts);
    expect(findings.map((finding) => finding.effect)).toEqual(['info', 'info']);
    expect(findings[1]?.message).toContain('`rmartz-pr-lifecycle[bot]`');
    expect(findings[1]?.message).toContain('sign-off-status-creators');
  });

  it('cannot pass a PR the fallback holds, whatever the status says', () => {
    // `requirement=none` from an untrusted App must not open the gate.
    expect(effects(pr(untrustedApp('v1 requirement=none')))).toEqual(['hold', 'info']);
  });

  it('ignores a forged github-actions[bot] status the same way', () => {
    const forged = lifecycle('v1 requirement=none', {
      creator: { login: 'github-actions[bot]', type: 'Bot', permission: 'none' },
    });
    expect(effects(pr(forged))).toEqual(['hold', 'info']);
  });

  it('uses the status once the caller trusts that App', () => {
    expect(
      decideUat(pr(untrustedApp('v1 requirement=none')), ['rmartz-pr-lifecycle[bot]']).findings.map(
        (finding) => finding.effect,
      ),
    ).toEqual(['info']);
  });
});

describe('decideUat — a trusted status the gate cannot use holds', () => {
  it.each([
    ['an unknown format version', lifecycle('v2 requirement=none')],
    ['a malformed description', lifecycle('v1 requirement=none colour=blue')],
    ['a trusted App with an unknown version', untrustedApp('v2 requirement=none')],
  ])('holds on %s, even where the fallback would pass', (_case, status) => {
    // A trivial PR passes the fallback, so only the rejected status can hold it.
    const facts = { ...pr(status), changedFiles: ['docs/a.md'] };
    const { findings } = decideUat(facts, ['rmartz-pr-lifecycle[bot]']);
    expect(findings.map((finding) => finding.effect)).toEqual(['hold']);
    expect(findings[0]?.message).toContain('Waiting on pr-lifecycle');
  });
});

describe('decideUat — falls back only while no status is present', () => {
  it('classifies a trivial PR itself when pr-lifecycle has posted nothing', () => {
    expect(effects({ ...pr(undefined), changedFiles: ['docs/a.md'] })).toEqual(['info']);
  });

  it('holds a code PR with no status and no sign-off, as before the cutover', () => {
    expect(effects(pr(undefined))).toEqual(['hold']);
  });

  it('lets a valid status override the fallback: a trivial PR classified uat holds', () => {
    const facts = {
      ...pr(lifecycle('v1 requirement=uat waiver=absent')),
      changedFiles: ['docs/a.md'],
    };
    expect(effects(facts)).toEqual(['hold']);
  });
});
