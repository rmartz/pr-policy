/**
 * Opt-in check: every PR carries an explicit UAT determination. While no UAT
 * label (`no UAT needed`, `UAT pending`, `UAT ready`, `UAT passed`, or a legacy
 * name) is on the PR, this check holds `pr-policy` pending, so a PR can't merge
 * when pr-lifecycle never labeled it (rmartz/pr-policy#103).
 *
 * It checks presence only, from any actor: pr-lifecycle writes these labels as
 * `github-actions[bot]`, and that must count. Presence never passes a PR on its
 * own; the `uat` check still decides whether the PR has the sign-off it needs,
 * so an untrusted label can't loosen anything. It is off by default
 * (`requireUatLabel`), because on a repo without pr-lifecycle it would hold
 * every PR, including the one that adds pr-lifecycle. Read-only: it never
 * applies or removes a label. See docs/checks/uat-label.md.
 */
import { UAT_LABELS } from '../contract.js';
import type { CheckResult, PolicyCheck, PullRequestFacts } from '../policy.js';

export const UAT_LABEL_CHECK = 'uat-label';

/** Match labels case-insensitively, as GitHub treats label names. */
const UAT = new Set<string>(UAT_LABELS.map((label) => label.toLowerCase()));

export function decideUatLabel(pr: Pick<PullRequestFacts, 'labels'>): CheckResult {
  const present = pr.labels.filter((label) => UAT.has(label.toLowerCase()));
  if (present.length > 0) {
    const names = present.map((label) => `\`${label}\``).join(', ');
    return {
      findings: [
        {
          check: UAT_LABEL_CHECK,
          message: `UAT determination recorded: ${names}.`,
          effect: 'info',
        },
      ],
    };
  }
  return {
    findings: [
      {
        check: UAT_LABEL_CHECK,
        message:
          'Waiting for a UAT determination: no UAT label is on the PR. pr-lifecycle applies one of `no UAT needed`, `UAT pending`, `UAT ready`, or `UAT passed` when it runs; a person can apply one too.',
        effect: 'hold',
      },
    ],
  };
}

export const uatLabelCheck: PolicyCheck = {
  name: UAT_LABEL_CHECK,
  evaluate: async (pr: PullRequestFacts) => decideUatLabel(pr),
};
