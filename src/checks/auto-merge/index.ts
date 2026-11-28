/**
 * The auto-merge guard. GitHub keeps native auto-merge enabled across new
 * pushes, so a review fix or a conflict resolution pushed after auto-merge was
 * armed would merge with nobody looking at it again. This check fails
 * `pr-policy` when the head that would merge no longer carries the change
 * auto-merge was armed on.
 *
 * - Auto-merge off: nothing to judge, so manual merges are unaffected.
 * - A bot's PR armed by a bot (bot-automerge's App on a Dependabot PR), with
 *   only that bot's verified commits: exempt. A bot arms by rule and re-judges
 *   every head itself.
 * - Armed on the current head: pass, and record it.
 * - The head moved since: compare the net change at the armed head and at the
 *   current one (src/checks/auto-merge/fingerprint.ts). The same change (a
 *   clean branch update or rebase) passes and re-arms at the new head; a
 *   different one blocks until someone re-reviews and re-arms.
 * - Anything unknown (no enable event, no record, an unreadable change) blocks:
 *   this sits inside the required `pr-policy` verdict, so it fails closed.
 *
 * It blocks rather than holds: the author clears it by disabling and
 * re-enabling auto-merge. See docs/checks/auto-merge.md.
 */
import type {
  ArmRecord,
  AutoMergeFacts,
  CheckResult,
  Finding,
  PolicyCheck,
  PullRequestAuthor,
  PullRequestFacts,
} from '../../policy.js';

export const AUTO_MERGE_CHECK = 'auto-merge';

const REARM =
  'Re-review the change, then disable and re-enable auto-merge to arm it on the current head.';

function short(sha: string): string {
  return `\`${sha.slice(0, 7)}\``;
}

function finding(effect: Finding['effect'], message: string): Finding {
  return { check: AUTO_MERGE_CHECK, effect, message };
}

/**
 * Whether the PR is a bot's PR armed by a bot, which exempts it from this
 * guard: a bot enabled auto-merge, a bot opened the PR, and every commit is
 * that bot's, with a signature GitHub verified. A person's commit pushed onto
 * a bot's PR puts it back under the guard.
 */
export function isBotArmed(autoMerge: AutoMergeFacts, author?: PullRequestAuthor): boolean {
  if (autoMerge.enabledBy.type !== 'Bot' || author?.type !== 'Bot') return false;
  const commits = autoMerge.commits ?? [];
  return (
    commits.length > 0 &&
    commits.every((commit) => commit.verified && commit.login === author.login)
  );
}

/**
 * The arm record that belongs to the current auto-merge request: one written
 * at or after auto-merge was last enabled. An older record is from an earlier
 * arming that was since disabled, and is ignored.
 */
export function currentRecord(autoMerge: AutoMergeFacts): ArmRecord | undefined {
  const { armed, enabledAt } = autoMerge;
  if (armed === undefined || enabledAt === undefined) return undefined;
  return Date.parse(armed.at) >= Date.parse(enabledAt) ? armed : undefined;
}

/**
 * Whether auto-merge was enabled strictly after the current head was pushed,
 * so the head it was armed on is the current head. An unknown push time can't
 * show that.
 */
function enabledAfterPush(enabledAt: string, headPushedAt: string | undefined): boolean {
  if (headPushedAt === undefined) return false;
  return Date.parse(enabledAt) > Date.parse(headPushedAt);
}

export function decideAutoMerge(pr: PullRequestFacts): CheckResult {
  const autoMerge = pr.autoMerge;
  if (autoMerge === undefined) return { findings: [] };
  const { enabledBy, enabledAt, headSha } = autoMerge;

  if (isBotArmed(autoMerge, pr.author)) {
    return {
      findings: [
        finding(
          'info',
          `Auto-merge was enabled by \`${enabledBy.login}\` on a PR holding only a bot's verified commits, so it isn't bound to an armed head.`,
        ),
      ],
    };
  }
  if (enabledAt === undefined) {
    return {
      findings: [
        finding(
          'block',
          `Auto-merge is enabled, but GitHub records no event for when, so the head it was armed on is unknown. ${REARM}`,
        ),
      ],
    };
  }

  const armedHere = finding('info', `Auto-merge is armed on the current head, ${short(headSha)}.`);
  const record = currentRecord(autoMerge);
  if (record === undefined) {
    if (enabledAfterPush(enabledAt, pr.headPushedAt)) {
      return { findings: [armedHere], autoMergeArm: headSha };
    }
    return {
      findings: [
        finding(
          'block',
          `Auto-merge was enabled before the current head ${short(headSha)} was pushed, and pr-policy has no record of the head it was armed on (it was enabled before this check ran, the caller doesn't run on \`auto_merge_enabled\`, or the run that records it didn't complete). ${REARM} Wait until CI has started on the head before re-enabling, so its push time is on record.`,
        ),
      ],
    };
  }
  if (record.sha === headSha) return { findings: [armedHere] };

  const { armedChange, headChange } = autoMerge;
  if (armedChange === undefined || headChange === undefined) {
    return {
      findings: [
        finding(
          'block',
          `Auto-merge was armed on ${short(record.sha)}, and the head has moved to ${short(headSha)}. The change at one of them couldn't be read to compare (too many files, or the read failed). ${REARM}`,
        ),
      ],
    };
  }
  if (armedChange === headChange) {
    return {
      findings: [
        finding(
          'info',
          `Auto-merge was armed on ${short(record.sha)}; ${short(headSha)} carries the same change (a clean branch update or rebase), so it is re-armed there.`,
        ),
      ],
      autoMergeArm: headSha,
    };
  }
  return {
    findings: [
      finding(
        'block',
        `Auto-merge was armed on ${short(record.sha)}, and the change has moved since: ${short(headSha)} adds or removes different lines. ${REARM}`,
      ),
    ],
  };
}

export const autoMergeCheck: PolicyCheck = {
  name: AUTO_MERGE_CHECK,
  evaluate: async (pr: PullRequestFacts) => decideAutoMerge(pr),
};
