/**
 * Check 1: CI-change classification. Turns the classifier's verdict over the
 * PR's `.github/workflows/**` diff into findings and `CI approval needed` edits.
 *
 * Two policies, settled in docs/decisions.md:
 *
 * 1. **Reconcile while unsigned, freeze once signed.** Until a human applies
 *    `CI change approved`, the gate label tracks the current head: added when
 *    the head loosens CI or changes what an existing check enforces, removed
 *    when a later push takes that away. A change that only strengthens CI (new
 *    checks, or an existing one made strictly stricter) needs no label.
 *    Once signed off it is never removed — it is the audit record, and silently
 *    reverting a human judgment is exactly what this package must not do.
 * 2. **`CI change approved` is never written here.** It is the human act the
 *    gate exists to require, and it counts only when a trusted person applied
 *    it (src/sign-off.ts).
 */
import { CI_APPROVAL_NEEDED_LABEL, CI_CHANGE_APPROVED_LABEL } from '../../contract.js';
import type { CheckResult, Finding, PolicyCheck, PullRequestFacts } from '../../policy.js';
import { signOffState, type SignOffState } from '../../sign-off.js';
import { classifyWorkflowChanges, type Classification } from './classify.js';
import type { Indicator } from './indicators.js';

export const CI_CHANGE_CHECK = 'ci-change';

function indicatorMessage(indicator: Indicator): string {
  return `\`${indicator.file}\` \`${indicator.location}\` — ${indicator.kind} (${indicator.class}): ${indicator.detail}`;
}

type CiFacts = Pick<PullRequestFacts, 'labels' | 'signOffs'>;

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

function notesOf(indicators: readonly Indicator[], prefix = ''): Finding[] {
  return indicators.map((indicator): Finding => ({
    check: CI_CHANGE_CHECK,
    message: `${prefix}${indicatorMessage(indicator)}`,
    effect: 'info',
  }));
}

const SHIPPED_PREFIX = 'Shipped reusable workflow, not CI: ';

/** Every note: what holds, then the stricter edits, then the shipped-workflow edits. */
function evidenceOf(classification: Classification): Finding[] {
  return [
    ...notesOf(classification.indicators),
    ...notesOf(classification.strengthening ?? []),
    ...notesOf(classification.shippedEdits ?? [], SHIPPED_PREFIX),
  ];
}

/**
 * Decide the findings and label edits for one classified PR: hold when CI
 * loosens or an existing check changes in a way not shown to be stricter, and
 * reconcile the label. Whatever else the PR changes doesn't matter.
 */
export function decideCiChange(classification: Classification, pr: CiFacts): CheckResult {
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
      message:
        'Workflow changes only strengthen CI (new checks, or existing ones made strictly stricter), are maintenance, or edit a shipped reusable workflow without loosening it. No sign-off needed.',
      effect: 'info',
    };
    return { findings: [note, ...evidenceOf(classification)], labelsToAdd, labelsToRemove };
  }

  // Unsigned is a `hold`, not a `block`: nothing is broken, the PR is waiting on
  // a human. Red would read as a failing build and send it round a fix loop that
  // cannot clear it (docs/decisions.md).
  const headline: Finding = signedOff
    ? {
        check: CI_CHANGE_CHECK,
        message: `CI change signed off with \`${CI_CHANGE_APPROVED_LABEL}\``,
        effect: 'info',
        headline: true,
      }
    : {
        check: CI_CHANGE_CHECK,
        message: `This PR loosens CI or changes what an existing check enforces, and is waiting for a human to review the change and apply \`${CI_CHANGE_APPROVED_LABEL}\`. No code change clears this. A change not shown to be strictly stricter is treated as loosening, because a miss skips the sign-off entirely.`,
        effect: 'hold',
      };
  return {
    findings: [headline, ...untrustedApproval(approval), ...evidenceOf(classification)],
    labelsToAdd,
    labelsToRemove,
  };
}

export const ciChangeCheck: PolicyCheck = {
  name: CI_CHANGE_CHECK,
  evaluate: async (pr: PullRequestFacts) =>
    decideCiChange(classifyWorkflowChanges(pr.workflowChanges), pr),
};
