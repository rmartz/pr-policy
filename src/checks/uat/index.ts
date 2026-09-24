/**
 * Check 3: UAT sign-off. A hard merge gate that **holds by default**. It passes
 * when the PR can't need UAT (every path is in an exempt category), when a
 * trusted person applied `no UAT needed`, or when one applied `UAT passed` (or
 * its old name, `tested`). A missing label is a hold, never "not required", so a
 * PR approved and armed for auto-merge at any point still waits here.
 *
 * Read-only: this check never applies or removes a UAT label. A stale label
 * across pushes is handled upstream: pr-lifecycle disarms on a push, and the
 * review agent refreshes its UAT label before its verdict. See docs/checks/uat.md.
 */
import {
  LEGACY_UAT_PASSED_LABEL,
  NO_UAT_NEEDED_LABEL,
  UAT_PASSED_LABEL,
} from '../../contract.js';
import type { CheckResult, Finding, PolicyCheck, PullRequestFacts } from '../../policy.js';
import { signOffState } from '../../sign-off.js';
import { trivialCategories } from './trivial.js';

export const UAT_CHECK = 'uat';

/** Every label that passes the gate, in the order a finding reports them. */
const PASSING_LABELS = [UAT_PASSED_LABEL, LEGACY_UAT_PASSED_LABEL, NO_UAT_NEEDED_LABEL];

function info(message: string): Finding {
  return { check: UAT_CHECK, message, effect: 'info' };
}

export function decideUat(pr: PullRequestFacts): CheckResult {
  const categories = trivialCategories(pr);
  if (categories !== undefined) {
    const kinds = categories.length > 0 ? categories.join(', ') : 'no files';
    return { findings: [info(`No UAT needed: the PR changes only ${kinds}.`)] };
  }

  const state = signOffState(pr, PASSING_LABELS);
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
  const why =
    state.status === 'untrusted' ? [info(`\`${state.label}\` doesn't count: ${state.reason}.`)] : [];
  return { findings: [hold, ...why] };
}

export const uatCheck: PolicyCheck = {
  name: UAT_CHECK,
  evaluate: async (pr: PullRequestFacts) => decideUat(pr),
};
