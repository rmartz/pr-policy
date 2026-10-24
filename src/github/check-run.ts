/**
 * Posting the `pr-policy` verdict: the one check-run, mirrored to a commit status.
 *
 * A `pending` outcome is posted as `in_progress` with no conclusion: GitHub
 * shows it as waiting, and a required check in that state still holds the
 * merge. Because a pending run is never completed by the job that posted it, the
 * next evaluation of the same head **updates** that run instead of creating a
 * new one, so no orphaned pending run is left behind next to the real verdict.
 *
 * Every verdict is also set as a `pr-policy` **commit status** (#24), and that
 * status is what the merge gate can rely on. A check-run created with
 * `GITHUB_TOKEN` gets no suite of its own: GitHub files it into the head SHA's
 * oldest `github-actions` check suite. Once a newer run of that suite's workflow
 * lands on the same SHA, the suite is superseded and the merge gate ignores every
 * check-run in it, while the checks list still shows it green. A commit status
 * belongs to no suite, so nothing can supersede it.
 */
import { PR_POLICY_CHECK_NAME } from '../contract.js';
import type { PolicyEvaluation } from '../evaluate.js';
import type { PullRequestTarget } from './pull-request.js';
import { clientOf } from './client.js';

interface CheckRunShape {
  id: number;
  status: string;
}

/**
 * Where to post the verdict. `name` is the check-run name and status context,
 * `pr-policy` unless a caller shadows under a distinct one (`pr-policy (app)`)
 * while another poster still owns the real name. Two creators posting one
 * context would overwrite each other.
 */
export interface VerdictOptions {
  name?: string;
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

/** The latest run named `name` on this head that is still open, if any. */
async function openRun(
  target: PullRequestTarget,
  headSha: string,
  name: string,
): Promise<number | null> {
  const out = await clientOf(target).getJson(
    `repos/${target.repo}/commits/${headSha}/check-runs?check_name=${encodeURIComponent(name)}&filter=latest`,
  );
  if (out === null) throw new Error(`could not list ${name} check-runs`);
  const runs = (out as { check_runs: CheckRunShape[] }).check_runs;
  return runs.find((run) => run.status !== 'completed')?.id ?? null;
}

/** Post (or complete) the one `pr-policy` check-run on the head commit. */
export async function postCheckRun(
  target: PullRequestTarget,
  headSha: string,
  evaluation: PolicyEvaluation,
  options: VerdictOptions = {},
): Promise<void> {
  const name = options.name ?? PR_POLICY_CHECK_NAME;
  const body = checkRunBody(evaluation, new Date());
  const existing = await openRun(target, headSha, name);
  const client = clientOf(target);
  const out =
    existing === null
      ? await client.send('POST', `repos/${target.repo}/check-runs`, {
          name,
          head_sha: headSha,
          ...body,
        })
      : await client.send('PATCH', `repos/${target.repo}/check-runs/${existing}`, body);
  if (out === null) throw new Error(`could not post the ${name} check-run`);
}

/** GitHub rejects a commit-status description longer than this. */
const STATUS_DESCRIPTION_MAX = 140;

/** The request body for the `pr-policy` commit status mirroring this evaluation. */
export function statusBody(
  evaluation: PolicyEvaluation,
  runUrl: string | undefined,
  name: string = PR_POLICY_CHECK_NAME,
): Record<string, unknown> {
  return {
    state: evaluation.outcome,
    context: name,
    description: evaluation.title.slice(0, STATUS_DESCRIPTION_MAX),
    ...(runUrl ? { target_url: runUrl } : {}),
  };
}

/**
 * Set the `pr-policy` commit status on the head. A failure only warns: a caller
 * that doesn't grant `statuses: write` yet still gets the check-run.
 */
async function postCommitStatus(
  target: PullRequestTarget,
  headSha: string,
  evaluation: PolicyEvaluation,
  name: string,
): Promise<void> {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  const runUrl =
    GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID
      ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
      : undefined;
  const out = await clientOf(target).send(
    'POST',
    `repos/${target.repo}/statuses/${headSha}`,
    statusBody(evaluation, runUrl, name),
  );
  if (out === null) {
    console.warn(
      `::warning::could not set the ${name} commit status on ${headSha} ` +
        '— does the caller workflow grant `statuses: write`? (rmartz/pr-policy#24)',
    );
  }
}

/** Post the verdict: the `pr-policy` check-run, then the matching commit status. */
export async function postVerdict(
  target: PullRequestTarget,
  headSha: string,
  evaluation: PolicyEvaluation,
  options: VerdictOptions = {},
): Promise<void> {
  const name = options.name ?? PR_POLICY_CHECK_NAME;
  await postCheckRun(target, headSha, evaluation, { name });
  await postCommitStatus(target, headSha, evaluation, name);
}
