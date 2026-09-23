import type { Finding } from './policy.js';

export type CheckRunConclusion = 'success' | 'failure';

/** The body of the one `pr-policy` check-run. */
export interface CheckRunReport {
  conclusion: CheckRunConclusion;
  title: string;
  summary: string;
  findings: readonly Finding[];
}

/**
 * Fold every check's findings into the single check-run. Any blocking finding
 * makes it `failure`; non-blocking findings are listed but never turn it red.
 */
export function buildReport(findings: readonly Finding[]): CheckRunReport {
  const blocking = findings.filter((finding) => finding.blocking);
  const conclusion = blocking.length > 0 ? 'failure' : 'success';
  const title =
    blocking.length > 0
      ? `${blocking.length} blocking policy finding${blocking.length === 1 ? '' : 's'}`
      : 'All PR policy checks pass';
  const lines = findings.map(
    (finding) => `- ${finding.blocking ? '❌' : 'ℹ️'} **${finding.check}**: ${finding.message}`,
  );
  const summary = lines.length > 0 ? lines.join('\n') : 'No policy findings.';
  return { conclusion, title, summary, findings };
}
