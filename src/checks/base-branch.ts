/**
 * Check 6: base branch. Which branch a PR may merge into is policy:
 *
 * - Any PR may merge into the default branch.
 * - A PR **without** the `epic` label may merge into the branch of an open epic
 *   PR, so a large feature accumulates its changes there.
 * - Anything else waits. An epic stacked on another PR, or any PR stacked on a
 *   non-epic PR, holds until its base PR merges and GitHub retargets it. So
 *   stacked epics land on the default branch one at a time, from the bottom up.
 *
 * A base branch that no open PR heads, and that isn't the default branch, is a
 * `block`: nothing will ever merge to release it, and the fix is a retarget.
 * Read-only: it never writes a label. See docs/checks/base-branch.md.
 */
import { EPIC_LABEL } from '../contract.js';
import type { CheckResult, PolicyCheck, PullRequestFacts } from '../policy.js';

export const BASE_BRANCH_CHECK = 'base-branch';

const isEpic = (labels: readonly string[]) =>
  labels.some((label) => label.trim().toLowerCase() === EPIC_LABEL);

export function decideBaseBranch(pr: PullRequestFacts): CheckResult {
  if (pr.base === undefined) return { findings: [] };
  const { branch, defaultBranch, headOf } = pr.base;
  if (branch === defaultBranch) return { findings: [] };

  const target = `This PR targets \`${branch}\``;
  const [parent] = headOf;
  if (parent === undefined) {
    return {
      findings: [
        {
          check: BASE_BRANCH_CHECK,
          message:
            `${target}, which is not the default branch and is not the head of an open PR. ` +
            `Retarget it to \`${defaultBranch}\`, or to an open epic PR's branch.`,
          effect: 'block',
        },
      ],
    };
  }

  const epicParent = headOf.find((open) => isEpic(open.labels));
  if (epicParent !== undefined && !isEpic(pr.labels)) return { findings: [] };

  const waitFor = epicParent ?? parent;
  const reason =
    epicParent === undefined
      ? `the branch of #${waitFor.number}, which is not an epic. Only an epic's branch accumulates other PRs`
      : `the branch of epic #${waitFor.number}. An epic merges into \`${defaultBranch}\` on its own, not into another epic`;
  return {
    findings: [
      {
        check: BASE_BRANCH_CHECK,
        message:
          `${target}, ${reason}. It can merge once #${waitFor.number} merges and ` +
          'GitHub retargets this PR to its base.',
        effect: 'hold',
      },
    ],
  };
}

export const baseBranchCheck: PolicyCheck = {
  name: BASE_BRANCH_CHECK,
  evaluate: async (pr: PullRequestFacts) => decideBaseBranch(pr),
};
