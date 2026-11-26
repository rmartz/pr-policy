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

const PUSHED_AT = '2026-10-01T12:00:00Z';
const AFTER_PUSH = '2026-10-01T12:30:00Z';
const BEFORE_PUSH = '2026-10-01T11:30:00Z';

/**
 * A code PR carrying `label`, last applied by `appliedBy` (nobody when
 * undefined) after the current head was pushed.
 */
const labelledBy = (label: string, appliedBy: LabelActor | undefined) =>
  pr({
    labels: [label, 'UI'],
    signOffs: [{ label, appliedBy, appliedAt: AFTER_PUSH }],
    headPushedAt: PUSHED_AT,
  });

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

describe('decideUat — a refactor passes without a label', () => {
  it.each(['refactor: extract the parser', 'refactor(auth): split the session module'])(
    'passes `%s` and names why',
    (title) => {
      const { findings } = decideUat(pr({ title, changedFiles: ['src/a.ts', 'src/b.ts'] }));
      expect(findings.map((finding) => finding.effect)).toEqual(['info']);
      expect(findings[0]?.message).toContain('refactor');
    },
  );

  it.each([
    'feat: add a thing',
    'fix: a refactor of the parser',
    'chore: refactor',
    'Refactor: extract the parser',
    'refactor extract the parser',
  ])('still holds `%s`', (title) => {
    expect(effects(pr({ title }))).toEqual(['hold']);
  });
});

describe('decideUat — sign-off labels', () => {
  it.each(['UAT passed', 'no UAT needed'])('passes on a trusted `%s`', (label) => {
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
      labels: ['UAT passed', 'no UAT needed'],
      signOffs: [
        { label: 'UAT passed', appliedBy: bot, appliedAt: AFTER_PUSH },
        { label: 'no UAT needed', appliedBy: MAINTAINER, appliedAt: AFTER_PUSH },
      ],
      headPushedAt: PUSHED_AT,
    });
    expect(effects(facts)).toEqual(['info']);
  });

  it('ignores provenance for a label that is no longer on the PR', () => {
    const facts = pr({ signOffs: [{ label: 'UAT passed', appliedBy: MAINTAINER }] });
    expect(effects(facts)).toEqual(['hold']);
  });
});

/** A code PR whose `label` a maintainer applied at `appliedAt`, with the head pushed at `PUSHED_AT`. */
const appliedAt = (
  label: string,
  at: string | undefined,
  headPushedAt: string | null = PUSHED_AT,
) =>
  pr({
    labels: [label],
    signOffs: [{ label, appliedBy: MAINTAINER, appliedAt: at }],
    ...(headPushedAt === null ? {} : { headPushedAt }),
  });

describe.each(['UAT passed', 'no UAT needed'])('decideUat — `%s` is bound to the head', (label) => {
  it('passes when applied after the head was pushed', () => {
    expect(effects(appliedAt(label, AFTER_PUSH))).toEqual(['info']);
  });

  it('holds when applied before the head was pushed, and says the head needs testing again', () => {
    const { findings } = decideUat(appliedAt(label, BEFORE_PUSH));
    expect(findings.map((finding) => finding.effect)).toEqual(['hold', 'info']);
    expect(findings[1]?.message).toContain(`\`${label}\` doesn't count`);
    expect(findings[1]?.message).toContain('before the current head was pushed');
    expect(findings[1]?.message).toContain('remove the label and apply it again');
  });

  it('holds when applied in the same instant as the push', () => {
    expect(effects(appliedAt(label, PUSHED_AT))).toEqual(['hold', 'info']);
  });

  it('holds when the push time is unknown', () => {
    const { findings } = decideUat(appliedAt(label, AFTER_PUSH, null));
    expect(findings[1]?.message).toContain('the time the current head was pushed is unknown');
  });

  it('holds when the time it was applied is unknown', () => {
    const { findings } = decideUat(appliedAt(label, undefined));
    expect(findings[1]?.message).toContain('the time it was applied is unknown');
  });

  it('holds when the applied time does not parse', () => {
    expect(effects(appliedAt(label, 'yesterday'))).toEqual(['hold', 'info']);
  });
});

describe('decideUat — stale and current sign-offs together', () => {
  it.each([
    ['UAT passed', 'no UAT needed'],
    ['no UAT needed', 'UAT passed'],
  ])('passes on a current `%s` beside a stale `%s`', (current, stale) => {
    const facts = pr({
      labels: ['UAT passed', 'no UAT needed'],
      signOffs: [
        { label: current, appliedBy: MAINTAINER, appliedAt: AFTER_PUSH },
        { label: stale, appliedBy: MAINTAINER, appliedAt: BEFORE_PUSH },
      ],
      headPushedAt: PUSHED_AT,
    });
    const { findings } = decideUat(facts);
    expect(findings.map((finding) => finding.effect)).toEqual(['info']);
    expect(findings[0]?.message).toContain(`\`${current}\``);
  });

  it('holds when both are stale, and says why for each', () => {
    const facts = pr({
      labels: ['UAT passed', 'no UAT needed'],
      signOffs: [
        { label: 'UAT passed', appliedBy: MAINTAINER, appliedAt: BEFORE_PUSH },
        { label: 'no UAT needed', appliedBy: MAINTAINER, appliedAt: BEFORE_PUSH },
      ],
      headPushedAt: PUSHED_AT,
    });
    expect(effects(facts)).toEqual(['hold', 'info', 'info']);
  });

  it('no longer reads the retired `tested` alias', () => {
    expect(effects(appliedAt('tested', AFTER_PUSH))).toEqual(['hold']);
  });
});

describe('decideUat — the `UAT needed` label', () => {
  const edits = (facts: PullRequestFacts) => {
    const { labelsToAdd, labelsToRemove } = decideUat(facts);
    return { labelsToAdd, labelsToRemove };
  };
  const none = { labelsToAdd: [], labelsToRemove: [] };

  it('adds it while the gate holds a ready PR', () => {
    expect(edits(pr({ draft: false }))).toEqual({
      labelsToAdd: ['UAT needed'],
      labelsToRemove: [],
    });
  });

  it('adds it when the draft state is unknown, which reads as ready', () => {
    expect(edits(pr())).toEqual({ labelsToAdd: ['UAT needed'], labelsToRemove: [] });
  });

  it('leaves it in place while the gate still holds', () => {
    expect(edits(pr({ labels: ['UAT needed'] }))).toEqual(none);
  });

  it('never adds it to a draft, which is not ready for UAT', () => {
    expect(edits(pr({ draft: true }))).toEqual(none);
  });

  it('removes it when the PR turns draft', () => {
    expect(edits(pr({ draft: true, labels: ['UAT needed'] }))).toEqual({
      labelsToAdd: [],
      labelsToRemove: ['UAT needed'],
    });
  });

  it.each(['UAT passed', 'no UAT needed'])(
    'removes it once a trusted `%s` passes the gate',
    (label) => {
      const facts = appliedAt(label, AFTER_PUSH);
      expect(edits({ ...facts, labels: [...facts.labels, 'UAT needed'] })).toEqual({
        labelsToAdd: [],
        labelsToRemove: ['UAT needed'],
      });
    },
  );

  it('adds it back when a push leaves the sign-off stale', () => {
    expect(edits(appliedAt('no UAT needed', BEFORE_PUSH))).toEqual({
      labelsToAdd: ['UAT needed'],
      labelsToRemove: [],
    });
  });

  it('keeps it while the only sign-off is untrusted', () => {
    const bot: LabelActor = { login: 'app[bot]', type: 'Bot', permission: 'none' };
    const facts = labelledBy('UAT passed', bot);
    expect(edits({ ...facts, labels: [...facts.labels, 'UAT needed'] })).toEqual(none);
  });

  it('removes it when the PR no longer needs UAT', () => {
    expect(edits(pr({ changedFiles: ['docs/a.md'], labels: ['UAT needed'] }))).toEqual({
      labelsToAdd: [],
      labelsToRemove: ['UAT needed'],
    });
    expect(edits(pr({ title: 'refactor: split it', labels: ['UAT needed'] }))).toEqual({
      labelsToAdd: [],
      labelsToRemove: ['UAT needed'],
    });
  });

  it('never touches it on a PR that needs no UAT and lacks it', () => {
    expect(edits(pr({ changedFiles: ['docs/a.md'] }))).toEqual(none);
  });
});
