import { CHECKS } from './checks/index.js';
import type { PolicyCheck, PullRequestFacts } from './policy.js';
import { buildReport } from './report.js';
import type { CheckRunReport } from './report.js';

/** The one check-run report, plus the label edits the checks planned. */
export interface PolicyEvaluation extends CheckRunReport {
  labelsToAdd: string[];
  labelsToRemove: string[];
}

/** Run every policy check against one PR and fold the results into one report. */
export async function evaluatePolicy(
  pr: PullRequestFacts,
  checks: readonly PolicyCheck[] = CHECKS,
): Promise<PolicyEvaluation> {
  const results = await Promise.all(checks.map((check) => check.evaluate(pr)));
  return {
    ...buildReport(results.flatMap((result) => result.findings)),
    labelsToAdd: results.flatMap((result) => result.labelsToAdd ?? []),
    labelsToRemove: results.flatMap((result) => result.labelsToRemove ?? []),
  };
}
