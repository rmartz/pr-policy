/**
 * Read pr-lifecycle's `pr-lifecycle/sign-off` commit status on the PR's head
 * SHA, and who posted it. The trust and format judgment is pure, in
 * src/sign-off-status.ts.
 */
import type { CommitStatus } from '../policy.js';
import { SIGN_OFF_STATUS_CONTEXT } from '../sign-off-status.js';
import type { PullRequestTarget } from './pull-request.js';
import { clientOf } from './client.js';
import { lookupPermission } from './sign-offs.js';

/** The fields of a commit status this reads; `creator` is `null` for a deleted user. */
interface StatusShape {
  context: string;
  state: string;
  description: string | null;
  creator: { login: string; type: string } | null;
}

/**
 * The latest `pr-lifecycle/sign-off` status on `sha`, or `undefined` when
 * pr-lifecycle hasn't posted one. GitHub lists a commit's statuses newest
 * first. A failed read throws: treating it as "no status" would drop the gate
 * back to its own classification.
 */
export async function gatherSignOffStatus(
  target: Pick<PullRequestTarget, 'repo' | 'cwd' | 'client'>,
  sha: string,
): Promise<CommitStatus | undefined> {
  const endpoint = `repos/${target.repo}/commits/${sha}/statuses`;
  const out = await clientOf(target).list(endpoint);
  if (out === null) throw new Error(`could not read ${endpoint}`);
  const latest = (out as StatusShape[]).find(
    (status) => status.context === SIGN_OFF_STATUS_CONTEXT,
  );
  if (latest === undefined) return undefined;

  const status: CommitStatus = { state: latest.state, description: latest.description ?? '' };
  if (latest.creator === null) return status;
  const { login, type } = latest.creator;
  // Only a person can classify for the gate, so a bot skips the permission lookup.
  const permission = type === 'User' ? await lookupPermission(target, login) : 'none';
  return { ...status, creator: { login, type, permission } };
}
