import { describe, expect, it } from 'vitest';
import { decideAutoMerge } from '../../../src/checks/auto-merge/index.js';
import type { AutoMergeFacts, PullRequestFacts } from '../../../src/policy.js';

const ARMED = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);

const base: PullRequestFacts = {
  title: 'feat: add a thing',
  labels: [],
  changedFiles: ['src/a.ts'],
  workflowChanges: [],
  manifestChanges: [],
  signOffs: [],
};

/** A PR whose head was pushed at 12:00 and whose auto-merge a person enabled at `enabledAt`. */
function pr(
  autoMerge: Partial<AutoMergeFacts>,
  headPushedAt = '2026-11-01T12:00:00Z',
): PullRequestFacts {
  const facts: AutoMergeFacts = {
    enabledBy: { login: 'someone', type: 'User' },
    enabledAt: '2026-11-01T11:00:00Z',
    headSha: HEAD,
    ...autoMerge,
  };
  facts.headPushedAt ??= headPushedAt;
  return { ...base, autoMerge: facts };
}

const person = { login: 'someone', type: 'User' };

const effects = (facts: PullRequestFacts) =>
  decideAutoMerge(facts).findings.map((finding) => finding.effect);

describe('decideAutoMerge', () => {
  it('has nothing to say while auto-merge is off, so a manual merge is unaffected', () => {
    expect(decideAutoMerge(base)).toEqual({ findings: [] });
  });

  describe('a bot PR armed by a bot, such as bot-automerge on a Dependabot PR', () => {
    const bot = (commits: AutoMergeFacts['commits']) => ({
      ...pr({ enabledBy: { login: 'merge-bot[bot]', type: 'Bot' }, enabledAt: undefined, commits }),
      author: { login: 'dependabot[bot]', type: 'Bot' },
    });

    it('is exempt while every commit is that bot’s verified work', () => {
      const result = decideAutoMerge(bot([{ login: 'dependabot[bot]', verified: true }]));
      expect(result.findings.map((finding) => finding.effect)).toEqual(['info']);
      expect(result.autoMergeArm).toBeUndefined();
    });

    it('is guarded once someone else’s commit is on it', () => {
      expect(
        effects(
          bot([
            { login: 'dependabot[bot]', verified: true },
            { login: 'someone', verified: true },
          ]),
        ),
      ).toEqual(['block']);
    });

    it('is guarded when a commit claiming the bot is unverified', () => {
      expect(effects(bot([{ login: 'dependabot[bot]', verified: false }]))).toEqual(['block']);
    });

    it('is guarded when a person opened the PR, even if a bot armed it', () => {
      const facts = { ...bot([{ login: 'dependabot[bot]', verified: true }]), author: person };
      expect(effects(facts)).toEqual(['block']);
    });
  });

  it('arms on the current head when auto-merge was enabled after the head was pushed', () => {
    const result = decideAutoMerge(pr({ enabledAt: '2026-11-01T12:30:00Z' }));
    expect(result.findings.map((finding) => finding.effect)).toEqual(['info']);
    expect(result.autoMergeArm).toBe(HEAD);
  });

  it('blocks when auto-merge was enabled in the same second the head was pushed', () => {
    expect(effects(pr({ enabledAt: '2026-11-01T12:00:00Z' }))).toEqual(['block']);
  });

  it('blocks when the head was pushed after enabling and there is no arm record', () => {
    const result = decideAutoMerge(pr({}));
    expect(result.findings.map((finding) => finding.effect)).toEqual(['block']);
    expect(result.findings[0]?.message).toContain('no record of the head it was armed on');
    expect(result.autoMergeArm).toBeUndefined();
  });

  it('blocks when the push time is unknown and there is no arm record', () => {
    const facts = pr({ enabledAt: '2026-11-01T12:30:00Z' });
    delete facts.autoMerge?.headPushedAt;
    expect(effects(facts)).toEqual(['block']);
  });

  it('blocks when GitHub records no enable event', () => {
    expect(effects(pr({ enabledAt: undefined }))).toEqual(['block']);
  });

  it('passes without rewriting a record that already names the current head', () => {
    const result = decideAutoMerge(pr({ armed: { sha: HEAD, at: '2026-11-01T11:00:05Z' } }));
    expect(result.findings.map((finding) => finding.effect)).toEqual(['info']);
    expect(result.autoMergeArm).toBeUndefined();
  });

  it('passes and re-arms when the moved head carries the same change', () => {
    const result = decideAutoMerge(
      pr({
        armed: { sha: ARMED, at: '2026-11-01T11:00:05Z' },
        armedChange: 'same',
        headChange: 'same',
      }),
    );
    expect(result.findings.map((finding) => finding.effect)).toEqual(['info']);
    expect(result.autoMergeArm).toBe(HEAD);
  });

  it('blocks, naming the armed head and the fix, when the change has moved', () => {
    const result = decideAutoMerge(
      pr({
        armed: { sha: ARMED, at: '2026-11-01T11:00:05Z' },
        armedChange: 'before',
        headChange: 'after',
      }),
    );
    expect(result.findings.map((finding) => finding.effect)).toEqual(['block']);
    expect(result.findings[0]?.message).toContain('armed on `aaaaaaa`');
    expect(result.findings[0]?.message).toContain('disable and re-enable auto-merge');
    expect(result.autoMergeArm).toBeUndefined();
  });

  it('prefers the record over the push time, so a head moved to an older commit still compares', () => {
    // The new head's commit was pushed elsewhere before auto-merge was enabled,
    // so its push time alone would read as "enabled after the push".
    const facts = pr(
      {
        enabledAt: '2026-11-01T12:30:00Z',
        armed: { sha: ARMED, at: '2026-11-01T12:30:05Z' },
        armedChange: 'before',
        headChange: 'after',
      },
      '2026-11-01T12:00:00Z',
    );
    expect(effects(facts)).toEqual(['block']);
  });

  it('blocks when either change could not be read', () => {
    const armed = { sha: ARMED, at: '2026-11-01T11:00:05Z' };
    expect(effects(pr({ armed, armedChange: 'x' }))).toEqual(['block']);
    expect(effects(pr({ armed, headChange: 'x' }))).toEqual(['block']);
  });

  it('ignores a record from an earlier arming, written before auto-merge was last enabled', () => {
    const stale = { sha: ARMED, at: '2026-11-01T10:00:00Z' };
    // Re-enabled after the push: arms fresh on the head despite the old record.
    const fresh = decideAutoMerge(pr({ enabledAt: '2026-11-01T12:30:00Z', armed: stale }));
    expect(fresh.autoMergeArm).toBe(HEAD);
    // Re-enabled before the push: the old record can't vouch for the change.
    expect(effects(pr({ armed: stale, armedChange: 'same', headChange: 'same' }))).toEqual([
      'block',
    ]);
  });
});
