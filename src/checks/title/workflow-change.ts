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
 *   code (rmartz/dotfiles#1581).
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

/** Whether a workflow document's `on:` is `workflow_call` and nothing else. */
function onlyWorkflowCall(doc: unknown): boolean {
  if (typeof doc !== 'object' || doc === null) return false;
  // YAML 1.1 readers turn a bare `on` key into `true`; the `yaml` parser keeps it.
  const on = (doc as Record<string, unknown>)['on'];
  if (on === 'workflow_call') return true;
  if (Array.isArray(on)) return on.length === 1 && on[0] === 'workflow_call';
  if (typeof on === 'object' && on !== null) {
    const events = Object.keys(on);
    return events.length === 1 && events[0] === 'workflow_call';
  }
  return false;
}

/**
 * Whether the file is a shipped reusable workflow, judged on its head content
 * (its base content, for a deletion). Only the trigger is inspected: a
 * `workflow_call`-only file that the repo also calls by local path would be
 * misread as shipped, and the fleet survey for rmartz/dotfiles#1581 found none.
 */
export function isShippedReusableWorkflow(change: FileChange): boolean {
  const text = change.headText ?? change.baseText;
  if (text === undefined) return false;
  const parsed = parses(text);
  return parsed !== null && onlyWorkflowCall(parsed.doc);
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
