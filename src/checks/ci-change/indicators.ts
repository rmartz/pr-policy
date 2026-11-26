/**
 * The indicator vocabulary — the classifier's whole output surface.
 *
 * Each indicator names one recognised change to a workflow document and the
 * class it falls in. `loosening` is a change the CI directive requires a human
 * to sign off. `ambiguous` changes what an existing check enforces in a way that
 * can't be shown to be strictly stricter, so it needs the same sign-off. Both
 * hold; they are kept apart so the check-run output can tell a reader which it
 * saw. `strengthening` is a recognised strictly-stricter edit to an existing
 * check: evidence only, it never holds.
 */

/** Changes that reduce CI coverage outright (review.md Step 5, "loosening indicators"). */
export const LOOSENING_INDICATORS = [
  'workflow-removed',
  'job-removed',
  'step-removed',
  'continue-on-error-added',
  'if-added',
  'trigger-narrowed',
  'matrix-reduced',
  'needs-reduced',
  'failure-ignored',
  'threshold-loosened',
  'strict-disabled',
  'timeout-raised',
] as const;

/** Changes to what an existing check enforces that can't be shown to be strictly stricter. */
export const AMBIGUOUS_INDICATORS = [
  'runs-on-changed',
  'permissions-changed',
  'env-changed',
  'timeout-changed',
  'check-changed',
  'unparseable',
  'unclassified-change',
] as const;

/** Recognised strictly-stricter edits to an existing check. They never hold. */
export const STRENGTHENING_INDICATORS = [
  'timeout-reduced',
  'threshold-tightened',
  'strict-enabled',
  'check-appended',
] as const;

export type LooseningIndicator = (typeof LOOSENING_INDICATORS)[number];
export type AmbiguousIndicator = (typeof AMBIGUOUS_INDICATORS)[number];
export type StrengtheningIndicator = (typeof STRENGTHENING_INDICATORS)[number];
export type IndicatorKind = LooseningIndicator | AmbiguousIndicator | StrengtheningIndicator;

/** Which bucket an indicator falls in. `loosening` and `ambiguous` hold the merge; `strengthening` never does. */
export type IndicatorClass = 'loosening' | 'ambiguous' | 'strengthening';

/** Whether an indicator needs the CI sign-off. */
export function holds(indicator: Indicator): boolean {
  return indicator.class !== 'strengthening';
}

/** One recognised change, bound to the file and the place in it that produced it. */
export interface Indicator {
  kind: IndicatorKind;
  class: IndicatorClass;
  /** Repo-relative path of the workflow file. */
  file: string;
  /** Where in the document — e.g. `jobs.build.steps[install]`, `on.pull_request.branches`. */
  location: string;
  /** One human-readable sentence naming what changed. */
  detail: string;
}

export function looseningIndicator(
  kind: LooseningIndicator,
  file: string,
  location: string,
  detail: string,
): Indicator {
  return { kind, class: 'loosening', file, location, detail };
}

export function ambiguousIndicator(
  kind: AmbiguousIndicator,
  file: string,
  location: string,
  detail: string,
): Indicator {
  return { kind, class: 'ambiguous', file, location, detail };
}

export function strengtheningIndicator(
  kind: StrengtheningIndicator,
  file: string,
  location: string,
  detail: string,
): Indicator {
  return { kind, class: 'strengthening', file, location, detail };
}

/**
 * The verdict for a whole pull request.
 *
 * - `no-change` — the diff touches no CI workflow file. Nothing to report.
 * - `tightening` — every change only strengthens CI (adds checks, or makes an
 *   existing one strictly stricter), is maintenance, or edits a shipped
 *   reusable workflow without loosening it.
 * - `loosening` — at least one loosening *or* ambiguous indicator fired: CI
 *   loosened, or an existing check changed in a way not shown to be stricter.
 *   The `CI approval needed` merge gate applies.
 */
export const CI_CHANGE_VERDICTS = ['no-change', 'tightening', 'loosening'] as const;

export type CiChangeVerdict = (typeof CI_CHANGE_VERDICTS)[number];
