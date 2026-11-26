/**
 * Which workflow changes make a PR a CI change for titling purposes. Anything
 * that alters what this repo's own CI does counts. Two kinds of change don't:
 *
 * - A pure action-pin bump (only `uses:` refs changed, as in every Dependabot
 *   github-actions PR) or a comment-only edit. It keeps its `chore` type per the
 *   Dependabot convention.
 * - A change to a **shipped reusable workflow**: one whose only trigger is
 *   `workflow_call`. In an action / reusable-workflow repo that file is the
 *   product consumers call, so it takes a release type like any other product
 *   code.
 */
import type { FileChange } from '../../policy.js';
import { isShippedReusableWorkflow, parses } from '../ci-change/shipped-workflow.js';
import { deepEqual, normalizeUses } from '../ci-change/structure.js';

function isPinBumpOnly(change: FileChange): boolean {
  if (change.baseText === undefined || change.headText === undefined) return false;
  const before = parses(change.baseText);
  const after = parses(change.headText);
  if (before === null || after === null) return false;
  return deepEqual(normalizeUses(before.doc), normalizeUses(after.doc));
}

/**
 * Paths of this repo's own CI workflows whose change is more than a pin bump or
 * a comment. Shipped reusable workflows are product code and never listed.
 */
export function substantiveWorkflowChanges(changes: readonly FileChange[]): string[] {
  return changes
    .filter((change) => !isShippedReusableWorkflow(change) && !isPinBumpOnly(change))
    .map((change) => change.path);
}
