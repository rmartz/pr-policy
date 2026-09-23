import type { Finding, FindingEffect } from './policy.js';

/**
 * The overall result of one evaluation. `pending` posts the check-run as
 * `in_progress` (no conclusion), so a PR waiting on a human sign-off shows as
 * waiting rather than as a failing build; the required check still holds the
 * merge until a later run completes it.
 */
export const POLICY_OUTCOMES = ['success', 'pending', 'failure'] as const;
export type PolicyOutcome = (typeof POLICY_OUTCOMES)[number];

/** The body of the one `pr-policy` check-run. */
export interface CheckRunReport {
  outcome: PolicyOutcome;
  title: string;
  summary: string;
  findings: readonly Finding[];
}

const ICONS: Record<FindingEffect, string> = { block: '❌', hold: '⏳', info: 'ℹ️' };

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Fold every check's findings into the single check-run. Any `block` finding
 * makes it `failure`; otherwise any `hold` makes it `pending`; otherwise it is
 * `success`. A fixable problem outranks a pending sign-off, so the author sees
 * the thing they can act on.
 */
export function buildReport(findings: readonly Finding[]): CheckRunReport {
  const blocks = findings.filter((finding) => finding.effect === 'block');
  const holds = findings.filter((finding) => finding.effect === 'hold');
  const headline = findings.find((finding) => finding.headline);

  let outcome: PolicyOutcome = 'success';
  let title = headline?.message ?? 'All PR policy checks pass';
  if (blocks.length > 0) {
    outcome = 'failure';
    title = plural(blocks.length, 'blocking policy finding');
  } else if (holds.length > 0) {
    outcome = 'pending';
    title = `Waiting on ${plural(holds.length, 'human sign-off')}`;
  }

  const lines = findings.map(
    (finding) => `- ${ICONS[finding.effect]} **${finding.check}**: ${finding.message}`,
  );
  const summary = lines.length > 0 ? lines.join('\n') : 'No policy findings.';
  return { outcome, title, summary, findings };
}
