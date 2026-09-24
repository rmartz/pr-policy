/**
 * Which workflow changes make a PR a CI change for titling purposes. Anything
 * that alters what CI does counts. A pure action-pin bump (only `uses:` refs
 * changed, as in every Dependabot github-actions PR) or a comment-only edit does
 * not: it keeps its `chore` type per the Dependabot convention, and requiring
 * `ci` would block every such bump fleet-wide.
 */
import { parse } from 'yaml';
import type { FileChange } from '../../policy.js';
import { deepEqual, normalizeUses } from '../ci-change/structure.js';

function parses(text: string): { doc: unknown } | null {
  try {
    return { doc: parse(text) };
  } catch {
    return null;
  }
}

function isPinBumpOnly(change: FileChange): boolean {
  if (change.baseText === undefined || change.headText === undefined) return false;
  const before = parses(change.baseText);
  const after = parses(change.headText);
  if (before === null || after === null) return false;
  return deepEqual(normalizeUses(before.doc), normalizeUses(after.doc));
}

/** Paths of workflow files whose change is more than a pin bump or a comment. */
export function substantiveWorkflowChanges(changes: readonly FileChange[]): string[] {
  return changes.filter((change) => !isPinBumpOnly(change)).map((change) => change.path);
}
