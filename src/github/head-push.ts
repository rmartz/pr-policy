/**
 * When a PR's current head was pushed, from times GitHub records and the author
 * can't forge. A commit's author and committer dates are whatever the pusher
 * wrote, so they are never read. Two server-side times stand in for the push:
 *
 * - the latest `head_ref_force_pushed` event on the PR, and
 * - the earliest check suite GitHub created for the head commit, which it does
 *   when the commit is first pushed.
 *
 * The later of the two is the push time. Neither can be later than the real
 * push, except a check suite created late, which only makes a sign-off look
 * staler. The `uat` check reads it to bind `UAT passed` to the head.
 */
import { ghCall } from '../lib/github.js';
import type { PullRequestTarget } from './pull-request.js';

async function lines(target: PullRequestTarget, endpoint: string, jq: string): Promise<string[]> {
  const out = await ghCall({ argv: ['gh', 'api', '--paginate', endpoint, '--jq', jq] }, null, {
    cwd: target.cwd,
  });
  // Throw rather than read no times: an empty list would hide the failure.
  if (out === null) throw new Error(`could not read ${endpoint}`);
  return out.split('\n').filter((line) => line.trim() !== '');
}

/** Epoch milliseconds of each parseable ISO 8601 timestamp. */
function times(stamps: readonly string[]): number[] {
  return stamps.map((stamp) => Date.parse(stamp)).filter((ms) => !Number.isNaN(ms));
}

/**
 * When the head was pushed, or `undefined` when GitHub records neither a force
 * push nor a check suite for it. A failed read throws.
 */
export async function gatherHeadPushedAt(
  target: PullRequestTarget,
  headSha: string,
): Promise<string | undefined> {
  const forcePushes = times(
    await lines(
      target,
      `repos/${target.repo}/issues/${target.pr}/events`,
      '.[] | select(.event == "head_ref_force_pushed") | .created_at',
    ),
  );
  const suites = times(
    await lines(
      target,
      `repos/${target.repo}/commits/${headSha}/check-suites`,
      '.check_suites[].created_at',
    ),
  );
  const candidates = [...forcePushes];
  if (suites.length > 0) candidates.push(Math.min(...suites));
  if (candidates.length === 0) return undefined;
  return new Date(Math.max(...candidates)).toISOString();
}
