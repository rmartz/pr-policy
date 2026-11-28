/**
 * The GitHub side of the `auto-merge` check: gather the auto-merge request,
 * when it was enabled, pr-policy's arm record, and (when the head has moved
 * since that record) the normalized change at both heads; then write the arm
 * marker a check asked for.
 *
 * Everything is read through the API, so no PR code is checked out. Every read
 * the decision depends on throws on failure, except the two compare reads,
 * whose failure leaves the fingerprint absent so the check blocks with a reason.
 */
import { currentRecord, isBotArmed } from '../checks/auto-merge/index.js';
import { changeFingerprint } from '../checks/auto-merge/fingerprint.js';
import type { CompareFile } from '../checks/auto-merge/fingerprint.js';
import { markerBody, parseMarker } from '../checks/auto-merge/marker.js';
import { PR_POLICY_CHECK_NAME } from '../contract.js';
import type { ArmRecord, AutoMergeFacts, CommitAuthorship, PullRequestAuthor } from '../policy.js';
import { clientOf } from './client.js';
import { gatherHeadPushedAt } from './head-push.js';
import type { PullRequestTarget } from './pull-request.js';

/** The REST `pull_request.auto_merge` object, reduced to what is read. */
export interface AutoMergeApi {
  enabled_by: { login: string; type: string } | null;
}

/** The parts of the REST pull request `gatherAutoMerge` reads. */
export interface AutoMergeView {
  auto_merge?: AutoMergeApi | null;
  user: PullRequestAuthor;
  head: { sha: string };
  base: { sha: string };
}

/** The issue events GitHub records when auto-merge is enabled, one per merge method. */
export const AUTO_MERGE_ENABLED_EVENTS = [
  'auto_merge_enabled',
  'auto_squash_enabled',
  'auto_rebase_enabled',
] as const;

interface IssueComment {
  id: number;
  body: string | null;
  user: { login: string; type: string } | null;
  created_at: string;
  updated_at: string;
}

interface Marker {
  sha: string;
  login: string;
  at: string;
}

async function list(target: PullRequestTarget, endpoint: string): Promise<unknown[]> {
  const out = await clientOf(target).list(endpoint);
  if (out === null) throw new Error(`could not read ${endpoint}`);
  return out;
}

/** When auto-merge was last enabled, from the PR's issue events. */
async function gatherEnabledAt(target: PullRequestTarget): Promise<string | undefined> {
  const events = (await list(target, `repos/${target.repo}/issues/${target.pr}/events`)) as {
    event: string;
    created_at: string;
  }[];
  const enabled: readonly string[] = AUTO_MERGE_ENABLED_EVENTS;
  const times = events
    .filter((event) => enabled.includes(event.event))
    .map((event) => event.created_at)
    .filter((at) => !Number.isNaN(Date.parse(at)));
  if (times.length === 0) return undefined;
  return times.reduce((latest, at) => (Date.parse(at) > Date.parse(latest) ? at : latest));
}

/** Who authored each PR commit, as GitHub resolves and verifies it. */
async function gatherCommits(target: PullRequestTarget): Promise<CommitAuthorship[]> {
  const commits = (await list(target, `repos/${target.repo}/pulls/${target.pr}/commits`)) as {
    author: { login: string } | null;
    commit: { verification?: { verified: boolean } | null };
  }[];
  return commits.map((commit) => {
    const authorship: CommitAuthorship = {
      verified: commit.commit.verification?.verified === true,
    };
    if (commit.author !== null) authorship.login = commit.author.login;
    return authorship;
  });
}

/**
 * Every unedited marker comment a bot wrote, newest first. A user can't author
 * a comment as a bot, and an edit by a write collaborator moves `updated_at`.
 */
function markers(comments: readonly IssueComment[]): (Marker & { id: number })[] {
  const found: (Marker & { id: number })[] = [];
  for (const comment of comments) {
    const sha = parseMarker(comment.body);
    if (sha === undefined || comment.user?.type !== 'Bot') continue;
    if (comment.updated_at !== comment.created_at) continue;
    found.push({ id: comment.id, sha, login: comment.user.login, at: comment.created_at });
  }
  return found.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** The bots that posted a `pr-policy` commit status on `sha`. */
async function statusPosters(target: PullRequestTarget, sha: string): Promise<Set<string>> {
  const statuses = (await list(target, `repos/${target.repo}/commits/${sha}/statuses`)) as {
    context: string;
    creator: { login: string; type: string } | null;
  }[];
  return new Set(
    statuses
      .filter((status) => status.context.startsWith(PR_POLICY_CHECK_NAME))
      .flatMap((status) => (status.creator?.type === 'Bot' ? [status.creator.login] : [])),
  );
}

/**
 * pr-policy's latest trusted arm record for the current auto-merge request: an
 * unedited marker written at or after `enabledAt`, by the same bot that posted
 * pr-policy's commit status on the SHA it records. Matching the status poster
 * ties the marker to pr-policy's own identity, so another bot (one that echoes
 * text a user wrote, say) can't plant one.
 */
async function gatherArmRecord(
  target: PullRequestTarget,
  enabledAt: string,
): Promise<ArmRecord | undefined> {
  const comments = (await list(
    target,
    `repos/${target.repo}/issues/${target.pr}/comments`,
  )) as IssueComment[];
  const since = Date.parse(enabledAt);
  for (const marker of markers(comments)) {
    if (Date.parse(marker.at) < since) break;
    if ((await statusPosters(target, marker.sha)).has(marker.login)) {
      return { sha: marker.sha, at: marker.at };
    }
  }
  return undefined;
}

/** The fingerprint of `sha`'s net change from its merge base with the base tip. */
async function gatherChange(
  target: PullRequestTarget,
  baseSha: string,
  sha: string,
): Promise<string | undefined> {
  const out = await clientOf(target).getJson(`repos/${target.repo}/compare/${baseSha}...${sha}`);
  const files = (out as { files?: CompareFile[] } | null)?.files;
  return files === undefined ? undefined : changeFingerprint(files);
}

/**
 * The auto-merge facts for a PR, or `undefined` while auto-merge is off. A
 * bot's PR armed by a bot is exempt, so nothing more is read for it.
 */
export async function gatherAutoMerge(
  target: PullRequestTarget,
  view: AutoMergeView,
): Promise<AutoMergeFacts | undefined> {
  if (view.auto_merge === undefined || view.auto_merge === null) return undefined;
  const enabledBy = view.auto_merge.enabled_by ?? { login: 'unknown', type: 'unknown' };
  const autoMerge: AutoMergeFacts = { enabledBy, headSha: view.head.sha };
  if (enabledBy.type === 'Bot' && view.user.type === 'Bot') {
    autoMerge.commits = await gatherCommits(target);
    if (isBotArmed(autoMerge, view.user)) return autoMerge;
  }

  const enabledAt = await gatherEnabledAt(target);
  if (enabledAt === undefined) return autoMerge;
  autoMerge.enabledAt = enabledAt;
  const armed = await gatherArmRecord(target, enabledAt);
  if (armed !== undefined) autoMerge.armed = armed;
  if (armed === undefined) {
    const pushedAt = await gatherHeadPushedAt(target, autoMerge.headSha, { requireSuite: true });
    if (pushedAt !== undefined) autoMerge.headPushedAt = pushedAt;
  }

  const record = currentRecord(autoMerge);
  if (record !== undefined && record.sha !== autoMerge.headSha) {
    const [armedChange, headChange] = await Promise.all([
      gatherChange(target, view.base.sha, record.sha),
      gatherChange(target, view.base.sha, autoMerge.headSha),
    ]);
    if (armedChange !== undefined) autoMerge.armedChange = armedChange;
    if (headChange !== undefined) autoMerge.headChange = headChange;
  }
  return autoMerge;
}

/**
 * Record `sha` as the armed head: post a new marker, then delete this same
 * identity's older markers, keeping the newest one before it. A new marker is
 * only trusted once pr-policy's status lands on its SHA (after this, in the
 * same run), so the kept one is the fallback if that never happens: the next
 * run still compares against it rather than finding no record. A new comment
 * rather than an edit, because an edited marker is never trusted. Another
 * bot's comment is never touched. A failed post leaves the old record; a
 * failed delete leaves an older marker that the newer ones outrank.
 */
export async function applyAutoMergeArm(target: PullRequestTarget, sha: string): Promise<void> {
  const client = clientOf(target);
  const endpoint = `repos/${target.repo}/issues/${target.pr}/comments`;
  const previous = await client.list(endpoint);
  const posted = (await client.send('POST', endpoint, { body: markerBody(sha) })) as {
    id?: number;
    user?: { login: string } | null;
  } | null;
  if (posted === null) {
    console.warn(`${target.repo}#${target.pr}: could not record the auto-merge arm on ${sha}`);
    return;
  }
  const self = posted.user?.login;
  if (self === undefined) return;
  const own = markers((previous ?? []) as IssueComment[]).filter(
    (marker) => marker.login === self && marker.id !== posted.id,
  );
  // Newest first, so the first is the fallback to keep.
  for (const marker of own.slice(1)) {
    await client.send('DELETE', `repos/${target.repo}/issues/comments/${marker.id}`);
  }
}
