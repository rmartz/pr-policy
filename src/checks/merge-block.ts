/**
 * Check 4: blocking labels. While a PR carries `do not merge`, `dnm`, `blocked`,
 * or `escalation needed`, this check holds `pr-policy` pending, so the label
 * stops every merge path: a person pressing merge, native auto-merge, or the
 * coordinator. Removing the label clears it.
 *
 * It holds rather than blocks: the label records a person's decision, and only a
 * person removing it can clear the gate. Read-only: it never applies or removes
 * a label. See docs/checks/merge-block.md.
 */
import { BLOCKING_LABELS } from '../contract.js';
import type { CheckResult, PolicyCheck, PullRequestFacts } from '../policy.js';

export const MERGE_BLOCK_CHECK = 'merge-block';

/**
 * Fold case and separators, so `Do Not Merge`, `do-not-merge`, and
 * `DO_NOT_MERGE` all match `do not merge`.
 */
function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[-_\s]+/g, ' ')
    .trim();
}

const BLOCKING = new Set(BLOCKING_LABELS.map(normalizeLabel));

export function decideMergeBlock(pr: PullRequestFacts): CheckResult {
  const present = pr.labels.filter((label) => BLOCKING.has(normalizeLabel(label)));
  if (present.length === 0) return { findings: [] };
  const names = present.map((label) => `\`${label}\``).join(', ');
  return {
    findings: [
      {
        check: MERGE_BLOCK_CHECK,
        message: `Held by ${names}. The PR can merge once ${present.length === 1 ? 'the label is' : 'the labels are'} removed.`,
        effect: 'hold',
      },
    ],
  };
}

export const mergeBlockCheck: PolicyCheck = {
  name: MERGE_BLOCK_CHECK,
  evaluate: async (pr: PullRequestFacts) => decideMergeBlock(pr),
};
