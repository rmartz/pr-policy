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
import {
  ignoredStatusMessage,
  readSignOffStatus,
  type SignOffClassification,
} from '../../sign-off-status.js';
import { signOffState, type SignOffState } from '../../sign-off.js';
import { classifyWorkflowChanges, type Classification } from './classify.js';
import type { Indicator } from './indicators.js';

export const CI_CHANGE_CHECK = 'ci-change';

function indicatorMessage(indicator: Indicator): string {
  return `\`${indicator.file}\` \`${indicator.location}\` — ${indicator.kind} (${indicator.class}): ${indicator.detail}`;
}

type CiFacts = Pick<PullRequestFacts, 'labels' | 'signOffs' | 'signOffStatus'>;

/**
 * Decide the findings and label edits for one classified PR. With a valid
 * `pr-lifecycle/sign-off` status, that status says whether a CI sign-off is
 * needed, and this check edits no label: pr-lifecycle writes `CI approval
 * needed` then. Without one, with one from a creator the gate doesn't trust,
 * or with a trusted one it can't use (the `uat` check holds on that), this
 * check classifies the workflow diff itself, as before the cutover.
 * `trustedBots` are the GitHub Apps the caller trusts to post the status,
 * besides a trusted person.
 */
export function decideCiChange(
  classification: Classification,
  pr: CiFacts,
  trustedBots: readonly string[] = [],
): CheckResult {
  const reading = readSignOffStatus(pr, trustedBots);
  switch (reading.kind) {
    case 'valid':
      return decideFromStatus(classification, pr, reading.classification);
    case 'ignored': {
      // Said here as well as in `uat`, which a caller may skip.
      const result = decideWithoutStatus(classification, pr);
      const note: Finding = {
        check: CI_CHANGE_CHECK,
        message: ignoredStatusMessage(reading.reason),
        effect: 'info',
      };
      return { ...result, findings: [...result.findings, note] };
    }
    case 'absent':
    case 'rejected':
      return decideWithoutStatus(classification, pr);
  }
}

function untrustedApproval(approval: SignOffState): Finding[] {
  return approval.status === 'untrusted'
    ? [
        {
          check: CI_CHANGE_CHECK,
          message: `\`${approval.label}\` doesn't count: ${approval.reason}.`,
          effect: 'info',
        },
      ]
    : [];
}

function evidenceOf(classification: Classification): Finding[] {
  return classification.indicators.map((indicator): Finding => ({
    check: CI_CHANGE_CHECK,
    message: indicatorMessage(indicator),
    effect: 'info',
  }));
}

function decideFromStatus(
  classification: Classification,
  pr: CiFacts,
  status: SignOffClassification,
): CheckResult {
  // `loosening=yes` covers a loosening bundled into a non-`ci` PR, which the
  // classification files under `uat`: it needs both sign-offs until it's split.
  const why =
    status.requirement === 'ci'
      ? 'pr-lifecycle classified this `ci` PR as needing a CI sign-off'
      : status.loosening
        ? 'pr-lifecycle reports that this PR loosens CI'
        : undefined;
  if (why === undefined) return { findings: [] };

  const approval = signOffState(pr, [CI_CHANGE_APPROVED_LABEL]);
  const headline: Finding =
    approval.status === 'trusted'
      ? {
          check: CI_CHANGE_CHECK,
          message: `CI change signed off with \`${CI_CHANGE_APPROVED_LABEL}\` by \`${approval.appliedBy.login}\``,
          effect: 'info',
          headline: true,
        }
      : {
          check: CI_CHANGE_CHECK,
          message: `Waiting for a CI sign-off: ${why}. A person reviews the change and applies \`${CI_CHANGE_APPROVED_LABEL}\`. No code change clears this.`,
          effect: 'hold',
        };
  return { findings: [headline, ...untrustedApproval(approval), ...evidenceOf(classification)] };
}

/** The pre-cutover decision: hold on a workflow loosening, and reconcile the label. */
function decideWithoutStatus(classification: Classification, pr: CiFacts): CheckResult {
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
  return {
    findings: [headline, ...untrustedApproval(approval), ...evidenceOf(classification)],
    labelsToAdd,
    labelsToRemove,
  };
}

/** The CI-change check for a caller that trusts `trustedBots` to post the sign-off status. */
export function ciChangeCheckFor(trustedBots: readonly string[]): PolicyCheck {
  return {
    name: CI_CHANGE_CHECK,
    evaluate: async (pr: PullRequestFacts) =>
      decideCiChange(classifyWorkflowChanges(pr.workflowChanges), pr, trustedBots),
  };
}

/** The CI-change check trusting only people to post the sign-off status. */
export const ciChangeCheck: PolicyCheck = ciChangeCheckFor([]);
