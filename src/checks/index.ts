import type { PolicyCheck } from '../policy.js';
import { ciChangeCheck } from './ci-change/index.js';

/**
 * Every registered policy check, in report order. Each check lives in its own
 * module under src/checks/ and is added here; all of them report into the single
 * `pr-policy` check-run. See docs/adding-a-check.md.
 */
export const CHECKS: readonly PolicyCheck[] = [ciChangeCheck];
