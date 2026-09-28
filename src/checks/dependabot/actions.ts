/**
 * What a Dependabot github-actions update changed in a workflow. Dependabot
 * moves `uses:` refs and nothing else, so the two documents must be equal once
 * every ref is stripped (the same normalization the ci-change and title checks
 * use). Given that, the `uses:` values line up one-to-one in document order, and
 * each pair that differs is one action update.
 */
import { parse } from 'yaml';
import type { FileChange } from '../../policy.js';
import {
  asArray,
  asRecord,
  deepEqual,
  normalizeUses,
  stripActionRef,
} from '../ci-change/structure.js';

/** A workflow's action updates, or why it isn't a pure pin bump. */
export type WorkflowDiff =
  { kind: 'pins'; actions: string[] } | { kind: 'unparseable' } | { kind: 'structural' };

function usesValues(node: unknown, into: string[] = []): string[] {
  const seq = asArray(node);
  if (seq) {
    for (const entry of seq) usesValues(entry, into);
    return into;
  }
  const map = asRecord(node);
  if (!map) return into;
  for (const [key, value] of Object.entries(map)) {
    if (key === 'uses' && typeof value === 'string') into.push(value);
    else usesValues(value, into);
  }
  return into;
}

function parses(text: string): { doc: unknown } | null {
  try {
    return { doc: parse(text) };
  } catch {
    return null;
  }
}

/** The actions whose ref changed, when the workflow changed only in refs. */
export function diffWorkflow(change: Required<FileChange>): WorkflowDiff {
  const before = parses(change.baseText);
  const after = parses(change.headText);
  if (before === null || after === null) return { kind: 'unparseable' };
  if (!deepEqual(normalizeUses(before.doc), normalizeUses(after.doc))) {
    return { kind: 'structural' };
  }
  const was = usesValues(before.doc);
  const now = usesValues(after.doc);
  const actions = now.flatMap((uses, index) => (uses === was[index] ? [] : [stripActionRef(uses)]));
  return { kind: 'pins', actions: [...new Set(actions)] };
}
