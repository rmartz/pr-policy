import { CHECKS } from './checks/index.js';
import type { PolicyCheck, PullRequestFacts } from './policy.js';
import { buildReport } from './report.js';
import type { CheckRunReport } from './report.js';

/** Run every policy check against one PR and fold the results into one report. */
export async function evaluatePolicy(
  pr: PullRequestFacts,
  checks: readonly PolicyCheck[] = CHECKS,
): Promise<CheckRunReport> {
  const results = await Promise.all(checks.map((check) => check.evaluate(pr)));
  return buildReport(results.flat());
}
