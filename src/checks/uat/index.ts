/**
 * Check 3: UAT sign-off. A hard merge gate that **holds by default**. A PR
 * doesn't need UAT when every path it touches is in an exempt category, or its
 * title is a `refactor`. Otherwise it passes only when a trusted person applied
 * `no UAT needed`, or `UAT passed` after the current head was pushed. A missing
 * sign-off is a hold, never "not required", so a PR armed for auto-merge at any
 * point still waits here.
 *
 * Read-only: this check never applies or removes a UAT label. See
 * docs/checks/uat.md.
 */
import { NO_UAT_NEEDED_LABEL, UAT_PASSED_LABEL } from '../../contract.js';
import type { CheckResult, Finding, PolicyCheck, PullRequestFacts } from '../../policy.js';
import { signOffState } from '../../sign-off.js';
import { parseTitle } from '../title/conventional.js';
import { trivialCategories } from './trivial.js';

export const UAT_CHECK = 'uat';

/** Every label that passes the gate, in the order a finding reports them. */
const PASSING_LABELS = [UAT_PASSED_LABEL, NO_UAT_NEEDED_LABEL];

/**
 * Sign-offs that say a person tested this code, so they count only for the head
 * they were applied to. A new head needs a person to look again, even after a
 * clean rebase.
 */
export const HEAD_BOUND_SIGN_OFFS = [UAT_PASSED_LABEL];

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

/** Decide the gate: trivial paths and `refactor` exempt; else a trusted, current sign-off. */
export function decideUat(pr: PullRequestFacts): CheckResult {
  const categories = trivialCategories(pr);
  if (categories !== undefined) {
    const kinds = categories.length > 0 ? categories.join(', ') : 'no files';
    return { findings: [info(`No UAT needed: the PR changes only ${kinds}.`)] };
  }

  // A refactor changes no behaviour, so there is nothing to user-test. The
  // title check blocks a refactor that touches a test, and a mislabeled
  // behaviour change would also lose its release, so the type is trusted here.
  if (parseTitle(pr.title)?.type === 'refactor') {
    return { findings: [info('No UAT needed: a refactor changes no behaviour.')] };
  }
  return { findings: signOffFindings(pr) };
}

/**
 * Whether a trusted, current sign-off is on a PR that needs UAT. A stale
 * `UAT passed` (older than the head) is set aside before trust is judged, so it
 * neither passes the gate nor hides a valid `no UAT needed`.
 */
function signOffFindings(pr: PullRequestFacts): Finding[] {
  const stale = PASSING_LABELS.flatMap((label) => {
    if (!pr.labels.includes(label)) return [];
    const reason = staleReason(pr, label);
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
    `Waiting for UAT. Apply \`${UAT_PASSED_LABEL}\` once a person has tested the current head, or \`${NO_UAT_NEEDED_LABEL}\` for a change that needs no user testing.`,
  );
  const why = stale.map(({ label, reason }) => info(`\`${label}\` doesn't count: ${reason}.`));
  if (state.status === 'untrusted') {
    why.push(info(`\`${state.label}\` doesn't count: ${state.reason}.`));
  }
  return [waiting, ...why];
}

export const uatCheck: PolicyCheck = {
  name: UAT_CHECK,
  evaluate: async (pr: PullRequestFacts) => decideUat(pr),
};
