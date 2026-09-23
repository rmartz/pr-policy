/**
 * Check 1: CI-change classification. Turns the classifier's verdict over the
 * PR's `.github/workflows/**` diff into findings and `CI approval needed` edits.
 *
 * Two policies, settled in docs/decisions.md:
 *
 * 1. **Reconcile while unsigned, freeze once signed.** Until a human applies
 *    `CI change approved`, the gate label tracks the current head: added when
 *    the head loosens CI, removed when a later push takes the loosening away.
 *    Once signed off it is never removed — it is the audit record, and silently
 *    reverting a human judgment is exactly what this package must not do.
 * 2. **`CI change approved` is never written here.** It is the human act the
 *    gate exists to require.
 */
import { CI_APPROVAL_NEEDED_LABEL, CI_CHANGE_APPROVED_LABEL } from '../../contract.js';
import type { CheckResult, Finding, PolicyCheck, PullRequestFacts } from '../../policy.js';
import { classifyWorkflowChanges, type Classification } from './classify.js';
import type { Indicator } from './indicators.js';

export const CI_CHANGE_CHECK = 'ci-change';

function indicatorMessage(indicator: Indicator): string {
  return `\`${indicator.file}\` \`${indicator.location}\` — ${indicator.kind} (${indicator.class}): ${indicator.detail}`;
}

/** Decide the findings and label edits for one classified PR. */
export function decideCiChange(
  classification: Classification,
  labels: readonly string[],
): CheckResult {
  const present = new Set(labels);
  const signedOff = present.has(CI_CHANGE_APPROVED_LABEL);
  const flagged = present.has(CI_APPROVAL_NEEDED_LABEL);
  const loosening = classification.verdict === 'loosening';

  const labelsToAdd = loosening && !flagged ? [CI_APPROVAL_NEEDED_LABEL] : [];
  const labelsToRemove = !loosening && flagged && !signedOff ? [CI_APPROVAL_NEEDED_LABEL] : [];

  if (classification.verdict === 'no-change') return { findings: [], labelsToAdd, labelsToRemove };
  if (!loosening) {
    const note: Finding = {
      check: CI_CHANGE_CHECK,
      message: 'Workflow changes only add coverage or are maintenance. No sign-off needed.',
      blocking: false,
    };
    return { findings: [note], labelsToAdd, labelsToRemove };
  }

  const headline: Finding = signedOff
    ? {
        check: CI_CHANGE_CHECK,
        message: `CI loosening signed off with \`${CI_CHANGE_APPROVED_LABEL}\`.`,
        blocking: false,
      }
    : {
        check: CI_CHANGE_CHECK,
        message: `This PR loosens CI. A human must review the change and apply \`${CI_CHANGE_APPROVED_LABEL}\`; no code change clears this. Ambiguous indicators are treated as loosening because a miss skips the sign-off entirely.`,
        blocking: true,
      };
  const evidence = classification.indicators.map((indicator): Finding => ({
    check: CI_CHANGE_CHECK,
    message: indicatorMessage(indicator),
    blocking: false,
  }));
  return { findings: [headline, ...evidence], labelsToAdd, labelsToRemove };
}

export const ciChangeCheck: PolicyCheck = {
  name: CI_CHANGE_CHECK,
  evaluate: async (pr: PullRequestFacts) =>
    decideCiChange(classifyWorkflowChanges(pr.workflowChanges), pr.labels),
};
