/**
 * A **shipped reusable workflow**: one whose only trigger is `workflow_call`.
 * In an action or reusable-workflow repo that file is the product consumers
 * call, not the repo's own CI. The title check types it as product code, and the
 * CI-change check holds only on its loosening (docs/decisions.md).
 */
import { parse } from 'yaml';
import type { FileChange } from '../../policy.js';
import { asRecord } from './structure.js';

/** The parsed document, or `null` when the text isn't YAML. */
export function parses(text: string): { doc: unknown } | null {
  try {
    return { doc: parse(text) };
  } catch {
    return null;
  }
}

/** Whether a workflow document's `on:` is `workflow_call` and nothing else. */
function onlyWorkflowCall(doc: unknown): boolean {
  // YAML 1.1 readers turn a bare `on` key into `true`; the `yaml` parser keeps it.
  const on = asRecord(doc)?.on;
  if (on === undefined) return false;
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
 * misread as shipped, and a fleet survey found none.
 */
export function isShippedReusableWorkflow(change: FileChange): boolean {
  const text = change.headText ?? change.baseText;
  if (text === undefined) return false;
  const parsed = parses(text);
  return parsed !== null && onlyWorkflowCall(parsed.doc);
}

/**
 * Whether the CI-change check reads the file as shipped: a shipped workflow on
 * every side that exists. A file that only becomes `workflow_call`-only, or
 * whose base can't be parsed, is still read as CI.
 */
export function isShippedOnEverySide(change: FileChange): boolean {
  const sides = [change.baseText, change.headText].filter(
    (text): text is string => text !== undefined,
  );
  return (
    sides.length > 0 &&
    sides.every((text) => {
      const parsed = parses(text);
      return parsed !== null && onlyWorkflowCall(parsed.doc);
    })
  );
}
