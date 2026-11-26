/**
 * A **shipped reusable workflow**: one whose only trigger is `workflow_call`.
 * In an action or reusable-workflow repo that file is the product consumers
 * call, not the repo's own CI. The title check types it as product code, and the
 * CI-change check holds only on its loosening (docs/decisions.md).
 */
import { parse } from 'yaml';
import type { FileChange } from '../../policy.js';

function parses(text: string): { doc: unknown } | null {
  try {
    return { doc: parse(text) };
  } catch {
    return null;
  }
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
 * misread as shipped, and a fleet survey found none.
 */
export function isShippedReusableWorkflow(change: FileChange): boolean {
  const text = change.headText ?? change.baseText;
  if (text === undefined) return false;
  const parsed = parses(text);
  return parsed !== null && onlyWorkflowCall(parsed.doc);
}
