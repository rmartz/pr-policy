/**
 * Read pr-lifecycle's `pr-lifecycle/sign-off` commit status on the PR's head
 * SHA, and who posted it. The trust and format judgment is pure, in
 * src/sign-off-status.ts.
 */
import { ghCall } from '../lib/github.js';
import type { CommitStatus } from '../policy.js';
import { SIGN_OFF_STATUS_CONTEXT } from '../sign-off-status.js';
import type { PullRequestTarget } from './pull-request.js';
import { lookupPermission } from './sign-offs.js';

interface StatusLine {
  context: string;
  state: string;
  description: string | null;
  login: string | null;
  type: string | null;
}

/**
 * The latest `pr-lifecycle/sign-off` status on `sha`, or `undefined` when
 * pr-lifecycle hasn't posted one. GitHub lists a commit's statuses newest
 * first. A failed read throws: treating it as "no status" would drop the gate
 * back to its own classification.
 */
export async function gatherSignOffStatus(
  target: Pick<PullRequestTarget, 'repo' | 'cwd'>,
  sha: string,
): Promise<CommitStatus | undefined> {
  const endpoint = `repos/${target.repo}/commits/${sha}/statuses`;
  const out = await ghCall(
    {
      argv: [
        'gh',
        'api',
        '--paginate',
        endpoint,
        '--jq',
        '.[] | {context, state, description, login: .creator.login, type: .creator.type}',
      ],
    },
    null,
    { cwd: target.cwd },
  );
  if (out === null) throw new Error(`could not read ${endpoint}`);
  const latest = out
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as StatusLine)
    .find((status) => status.context === SIGN_OFF_STATUS_CONTEXT);
  if (latest === undefined) return undefined;

  const status: CommitStatus = { state: latest.state, description: latest.description ?? '' };
  if (latest.login === null) return status;
  const type = latest.type ?? 'unknown actor';
  // Only a person can classify for the gate, so a bot skips the permission lookup.
  const permission = type === 'User' ? await lookupPermission(target, latest.login) : 'none';
  return { ...status, creator: { login: latest.login, type, permission } };
}
