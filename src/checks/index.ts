import type { PolicyCheck } from '../policy.js';
import { ciChangeCheck } from './ci-change/index.js';
import { titleCheck } from './title/index.js';
import { uatCheck } from './uat/index.js';

/**
 * Every registered policy check, in report order. Each check lives in its own
 * module under src/checks/ and is added here; all of them report into the single
 * `pr-policy` check-run. See docs/adding-a-check.md.
 */
export const CHECKS: readonly PolicyCheck[] = [titleCheck, ciChangeCheck, uatCheck];

/**
 * How a consuming repo tunes the suite. The caller passes these (a CLI flag, an
 * Action input), never the PR, so a PR can't switch off a gate it would fail.
 * Every option defaults to the strictest policy.
 */
export interface PolicyOptions {
  /** Drop the UAT gate, for a repo with no user-acceptance testing to wait on. */
  skipUat?: boolean;
}

/** The checks to run for a repo configured with `options`, in report order. */
export function selectChecks(options: PolicyOptions = {}): readonly PolicyCheck[] {
  return options.skipUat ? CHECKS.filter((check) => check !== uatCheck) : CHECKS;
}
