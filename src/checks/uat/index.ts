/**
 * Check 3: UAT sign-off. A hard merge gate that **holds by default**. Whether a
 * head needs UAT comes from pr-lifecycle's `pr-lifecycle/sign-off` status
 * (src/sign-off-status.ts); until a repo's pr-lifecycle posts one, the check
 * classifies the PR itself (every path in an exempt category, or a `refactor`
 * title). Under a `v2` status, a head that needs UAT passes on the sign-off
 * pr-lifecycle reports, without reading the labels. Under a `v1` status or none,
 * it passes when a trusted person applied `UAT passed` (or its old name,
 * `tested`) after the head was pushed, or `no UAT needed` that pr-lifecycle
 * reports as current. A missing sign-off is a hold, never
 * "not required", so a PR approved and armed for auto-merge at any point still
 * waits here.
 *
 * Read-only: this check never applies or removes a UAT label, and never reads
 * pr-lifecycle's own labels. See docs/checks/uat.md.
 */
import { LEGACY_UAT_PASSED_LABEL, NO_UAT_NEEDED_LABEL, UAT_PASSED_LABEL } from '../../contract.js';
import type { CheckResult, Finding, PolicyCheck, PullRequestFacts } from '../../policy.js';
import {
  ignoredStatusMessage,
  readSignOffStatus,
  rejectedStatusMessage,
  type SignOffClassification,
  type UatSignOffOutcome,
} from '../../sign-off-status.js';
import { signOffState } from '../../sign-off.js';
import { parseTitle } from '../title/conventional.js';
import { trivialCategories } from './trivial.js';

export const UAT_CHECK = 'uat';

/** Every label that passes the gate, in the order a finding reports them. */
const PASSING_LABELS = [UAT_PASSED_LABEL, LEGACY_UAT_PASSED_LABEL, NO_UAT_NEEDED_LABEL];

/**
 * Sign-offs that say a person tested this code, so they count only for the head
 * they were applied to. A new head needs a person to look again, even after a
 * clean rebase that carries an approval across.
 */
export const HEAD_BOUND_SIGN_OFFS = [UAT_PASSED_LABEL, LEGACY_UAT_PASSED_LABEL];

function info(message: string): Finding {
  return { check: UAT_CHECK, message, effect: 'info' };
}

function hold(message: string): Finding {
  return { check: UAT_CHECK, message, effect: 'hold' };
}

/** Why a head-bound sign-off on the PR doesn't cover the current head, if it doesn't. */
function staleReason(pr: PullRequestFacts, label: string): string | undefined {
  if (!HEAD_BOUND_SIGN_OFFS.includes(label)) return undefined;
  if (pr.headPushedAt === undefined) {
    return 'the time the current head was pushed is unknown, so it may predate the head';
  }
  const appliedAt = pr.signOffs.find((signOff) => signOff.label === label)?.appliedAt;
  if (appliedAt === undefined) return 'the time it was applied is unknown';
  // An unparseable time compares false, so it reads as stale.
  if (Date.parse(appliedAt) > Date.parse(pr.headPushedAt)) return undefined;
  return 'it was applied before the current head was pushed, and a new head needs a person to test it again';
}

/**
 * Decide the gate. pr-lifecycle's sign-off status, when present, says whether
 * this head needs UAT; a trusted status the gate can't use holds. With no
 * status, or one from a creator the gate doesn't trust, the check classifies
 * the PR itself, as before the cutover (fallback, removed by
 * rmartz/pr-policy#85). `trustedBots` are the GitHub Apps the caller trusts to
 * post the status, besides a trusted person.
 */
export function decideUat(pr: PullRequestFacts, trustedBots: readonly string[] = []): CheckResult {
  const reading = readSignOffStatus(pr, trustedBots);
  switch (reading.kind) {
    case 'absent':
      return { findings: decideWithoutStatus(pr) };
    case 'ignored':
      return {
        findings: [...decideWithoutStatus(pr), info(ignoredStatusMessage(reading.reason))],
      };
    case 'rejected':
      return { findings: [hold(rejectedStatusMessage(reading.reason))] };
    case 'valid':
      return { findings: decideFromStatus(pr, reading.classification) };
  }
}

function decideFromStatus(pr: PullRequestFacts, status: SignOffClassification): Finding[] {
  switch (status.requirement) {
    case 'none':
      return [info('No UAT needed: pr-lifecycle classified this head as needing no sign-off.')];
    case 'ci':
      return [info('No UAT needed: this head needs a CI sign-off instead (`ci-change`).')];
    case 'uat': {
      if ('signoff' in status) return fromReportedSignOff(status.signoff);
      // Only pr-lifecycle can tell whether a waiver survived a push (a verified
      // clean rebase carries it), so `no UAT needed` counts only when it says so.
      const waiver =
        status.waiver === 'current'
          ? []
          : [
              {
                label: NO_UAT_NEEDED_LABEL,
                reason: `pr-lifecycle reports the waiver as \`${status.waiver}\` for this head`,
              },
            ];
      return signOffFindings(pr, waiver);
    }
  }
}

/**
 * A `v2` status reports the UAT sign-off pr-lifecycle resolved, and the gate
 * trusts it alone (rmartz/pr-policy#109). pr-lifecycle already judged who
 * applied each label, which head it covers, and the review agent's verdicts,
 * which have no label for this check to read. So the UAT labels aren't read
 * here at all: a bot-applied `no UAT needed` is no reason to hold.
 */
function fromReportedSignOff(signoff: UatSignOffOutcome): Finding[] {
  const reported = `pr-lifecycle reports the UAT sign-off as \`${signoff}\` for this head`;
  if (signoff === 'absent') {
    return [
      hold(
        `Waiting for UAT: ${reported}. A person applies \`${UAT_PASSED_LABEL}\` after testing, or the review agent or a person waives it with \`${NO_UAT_NEEDED_LABEL}\`.`,
      ),
    ];
  }
  return [{ ...info(`UAT signed off: ${reported}.`), headline: true }];
}

/** The pre-cutover classification: trivial paths and `refactor` exempt; else a sign-off. */
function decideWithoutStatus(pr: PullRequestFacts): Finding[] {
  const categories = trivialCategories(pr);
  if (categories !== undefined) {
    const kinds = categories.length > 0 ? categories.join(', ') : 'no files';
    return [info(`No UAT needed: the PR changes only ${kinds}.`)];
  }

  // A refactor changes no behaviour, so there is nothing to user-test. The
  // title check blocks a refactor that touches a test, and a mislabeled
  // behaviour change would also lose its release, so the type is trusted here.
  if (parseTitle(pr.title)?.type === 'refactor') {
    return [info('No UAT needed: a refactor changes no behaviour.')];
  }
  return signOffFindings(pr, []);
}

/**
 * Whether a trusted, current sign-off is on a PR that needs UAT. A stale
 * sign-off (a `UAT passed` older than the head, or one in `setAside`) is removed
 * before trust is judged, so it neither passes the gate nor hides a valid one.
 */
function signOffFindings(
  pr: PullRequestFacts,
  setAside: readonly { label: string; reason: string }[],
): Finding[] {
  const stale = PASSING_LABELS.flatMap((label) => {
    if (!pr.labels.includes(label)) return [];
    const reason =
      setAside.find((entry) => entry.label === label)?.reason ?? staleReason(pr, label);
    return reason === undefined ? [] : [{ label, reason }];
  });
  const current = PASSING_LABELS.filter((label) => !stale.some((entry) => entry.label === label));
  const state = signOffState(pr, current);
  if (state.status === 'trusted') {
    return [
      {
        ...info(`UAT signed off with \`${state.label}\` by \`${state.appliedBy.login}\``),
        headline: true,
      },
    ];
  }

  const waiting = hold(
    `Waiting for UAT. A person applies \`${UAT_PASSED_LABEL}\` after testing, or the review agent or a person applies \`${NO_UAT_NEEDED_LABEL}\`.`,
  );
  const why = stale.map(({ label, reason }) => info(`\`${label}\` doesn't count: ${reason}.`));
  if (state.status === 'untrusted') {
    why.push(info(`\`${state.label}\` doesn't count: ${state.reason}.`));
  }
  return [waiting, ...why];
}

/** The UAT check for a caller that trusts `trustedBots` to post the sign-off status. */
export function uatCheckFor(trustedBots: readonly string[]): PolicyCheck {
  return { name: UAT_CHECK, evaluate: async (pr: PullRequestFacts) => decideUat(pr, trustedBots) };
}

/** The UAT check trusting only people to post the sign-off status. */
export const uatCheck: PolicyCheck = uatCheckFor([]);
