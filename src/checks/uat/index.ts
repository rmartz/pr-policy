/**
 * Check 3: UAT sign-off. A hard merge gate that **holds by default**. It passes
 * when the PR can't need UAT (every path is in an exempt category, or the title
 * is a `refactor`), when a
 * trusted person applied `no UAT needed`, or when one applied `UAT passed` (or
 * its old name, `tested`) after the current head was pushed. A missing label is
 * a hold, never "not required", so a PR approved and armed for auto-merge at any
 * point still waits here.
 *
 * Read-only: this check never applies or removes a UAT label. A `UAT passed`
 * from before the head was pushed simply doesn't count. A stale `no UAT needed`
 * is pr-lifecycle's to replace. See docs/checks/uat.md.
 */
import { LEGACY_UAT_PASSED_LABEL, NO_UAT_NEEDED_LABEL, UAT_PASSED_LABEL } from '../../contract.js';
import type { CheckResult, Finding, PolicyCheck, PullRequestFacts } from '../../policy.js';
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

  // A stale head-bound sign-off is set aside before trust is judged, so it
  // neither passes the gate nor hides a valid `no UAT needed` behind it.
  const stale = PASSING_LABELS.flatMap((label) => {
    const reason = pr.labels.includes(label) ? staleReason(pr, label) : undefined;
    return reason === undefined ? [] : [{ label, reason }];
  });
  const current = PASSING_LABELS.filter((label) => !stale.some((entry) => entry.label === label));
  const state = signOffState(pr, current);
  if (state.status === 'trusted') {
    return {
      findings: [
        {
          ...info(`UAT signed off with \`${state.label}\` by \`${state.appliedBy.login}\``),
          headline: true,
        },
      ],
    };
  }

  const hold: Finding = {
    check: UAT_CHECK,
    message: `Waiting for UAT. A person applies \`${UAT_PASSED_LABEL}\` after testing, or the review agent or a person applies \`${NO_UAT_NEEDED_LABEL}\`.`,
    effect: 'hold',
  };
  const why = stale.map(({ label, reason }) => info(`\`${label}\` doesn't count: ${reason}.`));
  if (state.status === 'untrusted') {
    why.push(info(`\`${state.label}\` doesn't count: ${state.reason}.`));
  }
  return { findings: [hold, ...why] };
}

export const uatCheck: PolicyCheck = {
  name: UAT_CHECK,
  evaluate: async (pr: PullRequestFacts) => decideUat(pr),
};
