/**
 * The classifier: given the before/after text of every CI workflow file a pull
 * request touches, decide whether the change only **strengthens** CI or needs
 * the CI sign-off because it **loosens** CI or changes what an existing check
 * enforces in a way not shown to be strictly stricter.
 *
 * Deciding this in code rather than by a reviewer reading the diff removes the
 * two failure modes an LLM-judged gate has: it cannot
 * be skipped (nothing has to remember to run a review), and it cannot misread a
 * diff. It is deliberately trigger-happy — see {@link containsAll}.
 */
import { parse } from 'yaml';
import type { FileChange } from '../../policy.js';
import {
  ambiguousIndicator,
  holds,
  looseningIndicator,
  type CiChangeVerdict,
  type Indicator,
} from './indicators.js';
import { jobIndicators } from './job-rules.js';
import { isShippedReusableWorkflow } from './shipped-workflow.js';
import { withoutJudgedFields } from './stricter.js';
import { containsAll, normalizeUses, type Node } from './structure.js';
import { topLevelIndicators, triggerIndicators } from './workflow-rules.js';

/** One workflow file's before/after text. */
export type WorkflowFileChange = FileChange;

/** The verdict for a pull request, with the evidence that produced it. */
export interface Classification {
  verdict: CiChangeVerdict;
  /** The loosening and ambiguous indicators: every one holds. */
  indicators: Indicator[];
  /** Strictly-stricter edits to existing checks. Evidence only. */
  strengthening?: Indicator[];
  /**
   * Edits to a shipped reusable workflow (`workflow_call` only) that don't
   * loosen it. It is product code, so these aren't CI changes.
   */
  shippedEdits?: Indicator[];
}

function parseWorkflow(text: string): { doc: Node } | { error: string } {
  try {
    return { doc: parse(text) as Node };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Every indicator for a single workflow file, of every class, read as CI. */
function assessWorkflowFile(change: WorkflowFileChange): Indicator[] {
  const { path, baseText, headText } = change;

  // A deleted workflow takes every check in it away — the plainest loosening there is.
  if (headText === undefined) {
    if (baseText === undefined) return [];
    return [
      looseningIndicator(
        'workflow-removed',
        path,
        path,
        'The workflow file was deleted, removing every check it defined.',
      ),
    ];
  }

  // A brand-new workflow only adds coverage.
  if (baseText === undefined) return [];

  const before = parseWorkflow(baseText);
  const after = parseWorkflow(headText);
  if ('error' in after) {
    return [
      ambiguousIndicator(
        'unparseable',
        path,
        path,
        `The workflow could not be parsed at head, so its change cannot be classified: ${after.error}`,
      ),
    ];
  }
  if ('error' in before) {
    return [
      ambiguousIndicator(
        'unparseable',
        path,
        path,
        `The workflow could not be parsed at the merge base, so its change cannot be classified: ${before.error}`,
      ),
    ];
  }

  const found = [
    ...triggerIndicators(path, before.doc, after.doc),
    ...topLevelIndicators(path, before.doc, after.doc),
    ...jobIndicators(path, before.doc, after.doc),
  ];
  if (found.some(holds)) return found;

  // Nothing that holds fired. Only call it strengthening if the head document
  // still contains everything the base one did, ignoring action version refs and
  // the fields the stricter rules already judged: the change is additive,
  // stricter, or cosmetic. Anything else is a structural edit no rule
  // recognised, and the directive says to treat that as a loosening.
  const comparable = (doc: Node) => withoutJudgedFields(normalizeUses(doc));
  if (containsAll(comparable(before.doc), comparable(after.doc))) return found;
  return [
    ...found,
    ambiguousIndicator(
      'unclassified-change',
      path,
      path,
      'The workflow changed in a way that is not purely additive and matches no known tightening pattern.',
    ),
  ];
}

/** One file's indicators, split into the ones that hold and the evidence that doesn't. */
function splitFile(change: WorkflowFileChange): Required<Omit<Classification, 'verdict'>> {
  const all = assessWorkflowFile(change);
  // A shipped reusable workflow is product code: only its loosening holds.
  if (isShippedReusableWorkflow(change)) {
    return {
      indicators: all.filter((indicator) => indicator.class === 'loosening'),
      strengthening: [],
      shippedEdits: all.filter((indicator) => indicator.class !== 'loosening'),
    };
  }
  return {
    indicators: all.filter(holds),
    strengthening: all.filter((indicator) => !holds(indicator)),
    shippedEdits: [],
  };
}

/** The indicators that hold for a single workflow file. */
export function classifyWorkflowFile(change: WorkflowFileChange): Indicator[] {
  return splitFile(change).indicators;
}

/** The pull-request-wide verdict across every workflow file it touches. */
export function classifyWorkflowChanges(changes: readonly WorkflowFileChange[]): Classification {
  if (changes.length === 0) return { verdict: 'no-change', indicators: [] };
  const files = changes.map(splitFile);
  const indicators = files.flatMap((file) => file.indicators);
  return {
    verdict: indicators.length > 0 ? 'loosening' : 'tightening',
    indicators,
    strengthening: files.flatMap((file) => file.strengthening),
    shippedEdits: files.flatMap((file) => file.shippedEdits),
  };
}
