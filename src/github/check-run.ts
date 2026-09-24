/**
 * Posting the one `pr-policy` check-run.
 *
 * A `pending` outcome is posted as `in_progress` with no conclusion: GitHub
 * shows it as waiting, and a required check in that state still holds the
 * merge. Because a pending run is never completed by the job that posted it, the
 * next evaluation of the same head **updates** that run instead of creating a
 * new one, so no orphaned pending run is left behind next to the real verdict.
 */
import { PR_POLICY_CHECK_NAME } from '../contract.js';
import type { PolicyEvaluation } from '../evaluate.js';
import { ghCall } from '../lib/github.js';
import type { PullRequestTarget } from './pull-request.js';

interface CheckRunShape {
  id: number;
  status: string;
}

/** The request body for this evaluation's check-run state. */
export function checkRunBody(evaluation: PolicyEvaluation, now: Date): Record<string, unknown> {
  const output = { title: evaluation.title, summary: evaluation.summary };
  if (evaluation.outcome === 'pending') return { status: 'in_progress', output };
  return {
    status: 'completed',
    conclusion: evaluation.outcome,
    completed_at: now.toISOString(),
    output,
  };
}

/** The latest `pr-policy` run on this head that is still open, if any. */
async function openRun(target: PullRequestTarget, headSha: string): Promise<number | null> {
  const out = await ghCall(
    {
      argv: [
        'gh',
        'api',
        `repos/${target.repo}/commits/${headSha}/check-runs?check_name=${PR_POLICY_CHECK_NAME}&filter=latest`,
        '--jq',
        '.check_runs',
      ],
    },
    null,
    { cwd: target.cwd },
  );
  if (out === null) throw new Error(`could not list ${PR_POLICY_CHECK_NAME} check-runs`);
  const runs = JSON.parse(out) as CheckRunShape[];
  return runs.find((run) => run.status !== 'completed')?.id ?? null;
}

/** Post (or complete) the one `pr-policy` check-run on the head commit. */
export async function postCheckRun(
  target: PullRequestTarget,
  headSha: string,
  evaluation: PolicyEvaluation,
): Promise<void> {
  const body = checkRunBody(evaluation, new Date());
  const existing = await openRun(target, headSha);
  const argv =
    existing === null
      ? ['gh', 'api', '-X', 'POST', `repos/${target.repo}/check-runs`, '--input', '-']
      : ['gh', 'api', '-X', 'PATCH', `repos/${target.repo}/check-runs/${existing}`, '--input', '-'];
  const payload =
    existing === null ? { name: PR_POLICY_CHECK_NAME, head_sha: headSha, ...body } : body;
  const out = await ghCall({ argv, stdin: JSON.stringify(payload) }, null, { cwd: target.cwd });
  if (out === null) throw new Error(`could not post the ${PR_POLICY_CHECK_NAME} check-run`);
}
