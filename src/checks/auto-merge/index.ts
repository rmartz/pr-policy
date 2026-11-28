/**
 * The auto-merge guard. GitHub keeps native auto-merge enabled across new
 * pushes, so a review fix or a conflict resolution pushed after auto-merge was
 * armed would merge with nobody looking at it again. This check fails
 * `pr-policy` when the head that would merge no longer carries the change
 * auto-merge was armed on.
 *
 * - Auto-merge off: nothing to judge, so manual merges are unaffected.
 * - Enabled by a bot (bot-automerge's App): exempt. A bot arms by rule and
 *   re-judges every head itself.
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

/** Whether a bot enabled auto-merge, which exempts the PR from this guard. */
export function isBotArmed(autoMerge: AutoMergeFacts): boolean {
  return autoMerge.enabledBy.type === 'Bot';
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

  if (isBotArmed(autoMerge)) {
    return {
      findings: [
        finding(
          'info',
          `Auto-merge was enabled by \`${enabledBy.login}\`, a bot that judges each head itself, so it isn't bound to an armed head.`,
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
          `Auto-merge was enabled before the current head ${short(headSha)} was pushed, and pr-policy has no record of the head it was armed on (it was enabled before this check ran, or the run that records it didn't complete). ${REARM}`,
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
