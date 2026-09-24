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
 *    gate exists to require, and it counts only when a trusted person applied
 *    it (src/sign-off.ts).
 */
import { CI_APPROVAL_NEEDED_LABEL, CI_CHANGE_APPROVED_LABEL } from '../../contract.js';
import type { CheckResult, Finding, PolicyCheck, PullRequestFacts } from '../../policy.js';
import { signOffState } from '../../sign-off.js';
import { classifyWorkflowChanges, type Classification } from './classify.js';
import type { Indicator } from './indicators.js';

export const CI_CHANGE_CHECK = 'ci-change';

function indicatorMessage(indicator: Indicator): string {
  return `\`${indicator.file}\` \`${indicator.location}\` — ${indicator.kind} (${indicator.class}): ${indicator.detail}`;
}

/** Decide the findings and label edits for one classified PR. */
export function decideCiChange(
  classification: Classification,
  pr: Pick<PullRequestFacts, 'labels' | 'signOffs'>,
): CheckResult {
  const approval = signOffState(pr, [CI_CHANGE_APPROVED_LABEL]);
  const signedOff = approval.status === 'trusted';
  const flagged = pr.labels.includes(CI_APPROVAL_NEEDED_LABEL);
  const loosening = classification.verdict === 'loosening';

  const labelsToAdd = loosening && !flagged ? [CI_APPROVAL_NEEDED_LABEL] : [];
  const labelsToRemove = !loosening && flagged && !signedOff ? [CI_APPROVAL_NEEDED_LABEL] : [];

  if (classification.verdict === 'no-change') return { findings: [], labelsToAdd, labelsToRemove };
  if (!loosening) {
    const note: Finding = {
      check: CI_CHANGE_CHECK,
      message: 'Workflow changes only add coverage or are maintenance. No sign-off needed.',
      effect: 'info',
    };
    return { findings: [note], labelsToAdd, labelsToRemove };
  }

  // Unsigned is a `hold`, not a `block`: nothing is broken, the PR is waiting on
  // a human. Red would read as a failing build and send it round a fix loop that
  // cannot clear it (docs/decisions.md).
  const headline: Finding = signedOff
    ? {
        check: CI_CHANGE_CHECK,
        message: `CI loosening signed off with \`${CI_CHANGE_APPROVED_LABEL}\``,
        effect: 'info',
        headline: true,
      }
    : {
        check: CI_CHANGE_CHECK,
        message: `This PR loosens CI and is waiting for a human to review the change and apply \`${CI_CHANGE_APPROVED_LABEL}\`. No code change clears this. Ambiguous indicators are treated as loosening because a miss skips the sign-off entirely.`,
        effect: 'hold',
      };
  const untrusted: Finding[] =
    approval.status === 'untrusted'
      ? [
          {
            check: CI_CHANGE_CHECK,
            message: `\`${approval.label}\` doesn't count: ${approval.reason}.`,
            effect: 'info',
          },
        ]
      : [];
  const evidence = classification.indicators.map((indicator): Finding => ({
    check: CI_CHANGE_CHECK,
    message: indicatorMessage(indicator),
    effect: 'info',
  }));
  return { findings: [headline, ...untrusted, ...evidence], labelsToAdd, labelsToRemove };
}

export const ciChangeCheck: PolicyCheck = {
  name: CI_CHANGE_CHECK,
  evaluate: async (pr: PullRequestFacts) =>
    decideCiChange(classifyWorkflowChanges(pr.workflowChanges), pr),
};
