import { CHECKS } from './checks/index.js';
import type { PolicyCheck, PullRequestFacts } from './policy.js';
import { buildReport } from './report.js';
import type { CheckRunReport } from './report.js';

/** The one check-run report, plus the label edits the checks planned. */
export interface PolicyEvaluation extends CheckRunReport {
  labelsToAdd: string[];
  labelsToRemove: string[];
  /** The head SHA to record as armed for auto-merge, if a check asked for one. */
  autoMergeArm?: string;
}

/** Run every policy check against one PR and fold the results into one report. */
export async function evaluatePolicy(
  pr: PullRequestFacts,
  checks: readonly PolicyCheck[] = CHECKS,
): Promise<PolicyEvaluation> {
  const results = await Promise.all(checks.map((check) => check.evaluate(pr)));
  const evaluation: PolicyEvaluation = {
    ...buildReport(results.flatMap((result) => result.findings)),
    labelsToAdd: results.flatMap((result) => result.labelsToAdd ?? []),
    labelsToRemove: results.flatMap((result) => result.labelsToRemove ?? []),
  };
  const arm = results.find((result) => result.autoMergeArm !== undefined)?.autoMergeArm;
  if (arm !== undefined) evaluation.autoMergeArm = arm;
  return evaluation;
}
