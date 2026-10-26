import { describe, expect, it } from 'vitest';
import type { Classification } from '../../../src/checks/ci-change/classify.js';
import { decideCiChange } from '../../../src/checks/ci-change/index.js';
import { decideUat } from '../../../src/checks/uat/index.js';
import { CI_CHANGE_APPROVED_LABEL } from '../../../src/contract.js';
import type { CommitStatus, LabelActor, PullRequestFacts, SignOff } from '../../../src/policy.js';

const LIFECYCLE_APP = 'rmartz-pr-lifecycle[bot]';
const APP: LabelActor = { login: LIFECYCLE_APP, type: 'Bot', permission: 'none' };
const MAINTAINER: LabelActor = { login: 'reed', type: 'User', permission: 'maintain' };
const PUSHED_AT = '2026-10-01T12:00:00Z';

/** A status posted by the pr-lifecycle App, which the caller trusts by default here. */
const fromApp = (description: string, overrides: Partial<CommitStatus> = {}): CommitStatus => ({
  state: 'success',
  description,
  creator: APP,
  ...overrides,
});

/** A code PR (never trivial) with pr-lifecycle's status and the given sign-offs. */
function pr(signOffStatus: CommitStatus, signOffs: SignOff[] = []): PullRequestFacts {
  return {
    title: 'feat: add a page',
    labels: signOffs.map((signOff) => signOff.label),
    changedFiles: ['src/page.tsx'],
    workflowChanges: [],
    manifestChanges: [],
    signOffs,
    headPushedAt: PUSHED_AT,
    signOffStatus,
  };
}

const decide = (facts: PullRequestFacts, trusted: readonly string[] = [LIFECYCLE_APP]) =>
  decideUat(facts, trusted).findings;
const effects = (facts: PullRequestFacts, trusted?: readonly string[]) =>
  decide(facts, trusted).map((finding) => finding.effect);

/** pr-lifecycle writes every UAT label as its own App, for people to read. */
const botWaiver: SignOff = { label: 'no UAT needed', appliedBy: APP };
/** A trusted `UAT passed` from before the current head: stale under v1's binding. */
const carriedPass: SignOff = {
  label: 'UAT passed',
  appliedBy: MAINTAINER,
  appliedAt: '2026-10-01T11:00:00Z',
};

describe('decideUat — a v2 status reports the UAT sign-off, and the gate trusts it alone', () => {
  it.each(['waived', 'passed'])(
    'passes on signoff=%s and names the reported outcome',
    (outcome) => {
      const findings = decide(pr(fromApp(`v2 requirement=uat signoff=${outcome}`)));
      expect(findings.map((finding) => finding.effect)).toEqual(['info']);
      expect(findings[0]?.headline).toBe(true);
      expect(findings[0]?.message).toContain(
        `pr-lifecycle reports the UAT sign-off as \`${outcome}\``,
      );
    },
  );

  it('holds on signoff=absent and names the reported outcome', () => {
    const findings = decide(pr(fromApp('v2 requirement=uat signoff=absent')));
    expect(findings.map((finding) => finding.effect)).toEqual(['hold']);
    expect(findings[0]?.message).toContain('pr-lifecycle reports the UAT sign-off as `absent`');
  });

  it('passes on waived with a bot-applied no UAT needed, with no untrusted-label finding', () => {
    const findings = decide(pr(fromApp('v2 requirement=uat signoff=waived'), [botWaiver]));
    expect(findings.map((finding) => finding.effect)).toEqual(['info']);
    expect(findings.some((finding) => finding.message.includes("doesn't count"))).toBe(false);
  });

  it('passes a carried-over UAT passed, without binding it to the head', () => {
    expect(effects(pr(fromApp('v2 requirement=uat signoff=passed'), [carriedPass]))).toEqual([
      'info',
    ]);
  });

  it('does not read the labels: a trusted, current UAT passed cannot override absent', () => {
    const current: SignOff = { ...carriedPass, appliedAt: '2026-10-01T12:30:00Z' };
    expect(effects(pr(fromApp('v2 requirement=uat signoff=absent'), [current]))).toEqual(['hold']);
  });

  it.each(['none', 'ci'])('passes a v2 requirement=%s head with no UAT hold', (requirement) => {
    expect(effects(pr(fromApp(`v2 requirement=${requirement}`)))).toEqual(['info']);
  });
});

describe('decideUat — a v2 status keeps the creator trust rule', () => {
  it('ignores a v2 status from an untrusted App, and falls back to the labels', () => {
    // The fallback reads the bot-applied waiver as untrusted, so the code PR holds.
    const findings = decide(pr(fromApp('v2 requirement=uat signoff=waived'), [botWaiver]), []);
    expect(findings.map((finding) => finding.effect)).toEqual(['hold', 'info', 'info']);
    expect(findings[2]?.message).toContain(`\`${LIFECYCLE_APP}\``);
  });

  it('ignores a forged v2 status from github-actions[bot]', () => {
    const forged = fromApp('v2 requirement=uat signoff=passed', {
      creator: { login: 'github-actions[bot]', type: 'Bot', permission: 'none' },
    });
    expect(effects(pr(forged))).toEqual(['hold', 'info']);
  });
});

describe('decideUat — a malformed v2 status from a trusted creator holds', () => {
  it.each([
    ['signoff with requirement=none', 'v2 requirement=none signoff=passed'],
    ['requirement=uat without signoff', 'v2 requirement=uat'],
    ['waiver in v2', 'v2 requirement=uat waiver=current'],
    ['signoff in v1', 'v1 requirement=uat signoff=passed'],
    ['an unknown signoff value', 'v2 requirement=uat signoff=current'],
  ])('holds on %s, even where the fallback would pass', (_case, description) => {
    // A trivial PR passes the fallback, so only the rejected status can hold it.
    const facts = { ...pr(fromApp(description)), changedFiles: ['docs/a.md'] };
    const findings = decide(facts);
    expect(findings.map((finding) => finding.effect)).toEqual(['hold']);
    expect(findings[0]?.message).toContain('Waiting on pr-lifecycle');
  });
});

describe('decideCiChange — a v2 status leaves the CI sign-off as it was', () => {
  const NO_CHANGE: Classification = { verdict: 'no-change', indicators: [] };
  const ciFacts = (description: string, signOffs: SignOff[] = []) => ({
    labels: signOffs.map((signOff) => signOff.label),
    signOffs,
    signOffStatus: fromApp(description),
  });

  it('still holds a ci head until a trusted person applies CI change approved', () => {
    const decideCi = (signOffs: SignOff[]) =>
      decideCiChange(NO_CHANGE, ciFacts('v2 requirement=ci', signOffs), [LIFECYCLE_APP]).findings[0]
        ?.effect;
    expect(decideCi([])).toBe('hold');
    expect(decideCi([{ label: CI_CHANGE_APPROVED_LABEL, appliedBy: APP }])).toBe('hold');
    expect(decideCi([{ label: CI_CHANGE_APPROVED_LABEL, appliedBy: MAINTAINER }])).toBe('info');
  });

  it('still needs CI change approved for a loosening on a waived uat head', () => {
    const facts = ciFacts('v2 requirement=uat signoff=waived loosening=yes');
    expect(decideCiChange(NO_CHANGE, facts, [LIFECYCLE_APP]).findings[0]?.effect).toBe('hold');
  });
});
