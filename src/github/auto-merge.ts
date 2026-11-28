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
import type { ArmRecord, AutoMergeFacts } from '../policy.js';
import { clientOf } from './client.js';
import type { PullRequestTarget } from './pull-request.js';

/** The REST `pull_request.auto_merge` object, reduced to what is read. */
export interface AutoMergeApi {
  enabled_by: { login: string; type: string } | null;
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

/** Every marker comment a bot wrote, oldest first. */
function markers(comments: readonly IssueComment[]): IssueComment[] {
  return comments.filter((comment) => comment.user?.type === 'Bot' && parseMarker(comment.body));
}

/**
 * pr-policy's latest trusted arm record: a bot-authored marker nobody has
 * edited. A user can't author a comment as a bot, and an edit by a write
 * collaborator moves `updated_at`, so an edited marker is never trusted.
 */
async function gatherArmRecord(target: PullRequestTarget): Promise<ArmRecord | undefined> {
  const comments = (await list(
    target,
    `repos/${target.repo}/issues/${target.pr}/comments`,
  )) as IssueComment[];
  let latest: ArmRecord | undefined;
  for (const comment of markers(comments)) {
    if (comment.updated_at !== comment.created_at) continue;
    const sha = parseMarker(comment.body);
    if (sha === undefined) continue;
    if (latest === undefined || Date.parse(comment.created_at) >= Date.parse(latest.at)) {
      latest = { sha, at: comment.created_at };
    }
  }
  return latest;
}

/** The fingerprint of `sha`'s net change from its merge base with `base`. */
async function gatherChange(
  target: PullRequestTarget,
  base: string,
  sha: string,
): Promise<string | undefined> {
  const out = await clientOf(target).getJson(`repos/${target.repo}/compare/${base}...${sha}`);
  const files = (out as { files?: CompareFile[] } | null)?.files;
  return files === undefined ? undefined : changeFingerprint(files);
}

/**
 * The auto-merge facts for a PR, or `undefined` while auto-merge is off. A
 * bot-enabled request is exempt, so nothing more is read for it.
 */
export async function gatherAutoMerge(
  target: PullRequestTarget,
  view: { auto_merge?: AutoMergeApi | null; head: { sha: string }; base: { ref: string } },
): Promise<AutoMergeFacts | undefined> {
  if (view.auto_merge === undefined || view.auto_merge === null) return undefined;
  const enabledBy = view.auto_merge.enabled_by ?? { login: 'unknown', type: 'unknown' };
  const autoMerge: AutoMergeFacts = { enabledBy, headSha: view.head.sha };
  if (isBotArmed(autoMerge)) return autoMerge;

  const enabledAt = await gatherEnabledAt(target);
  if (enabledAt !== undefined) autoMerge.enabledAt = enabledAt;
  const armed = await gatherArmRecord(target);
  if (armed !== undefined) autoMerge.armed = armed;

  const record = currentRecord(autoMerge);
  if (record !== undefined && record.sha !== autoMerge.headSha) {
    const [armedChange, headChange] = await Promise.all([
      gatherChange(target, view.base.ref, record.sha),
      gatherChange(target, view.base.ref, autoMerge.headSha),
    ]);
    if (armedChange !== undefined) autoMerge.armedChange = armedChange;
    if (headChange !== undefined) autoMerge.headChange = headChange;
  }
  return autoMerge;
}

/**
 * Record `sha` as the armed head: post a new marker, then delete the bot
 * markers it supersedes. A new comment rather than an edit, because an edited
 * marker is never trusted. A failed post leaves the old record, so a later
 * moved head blocks rather than passes; a failed delete leaves an older marker
 * that the newer one outranks.
 */
export async function applyAutoMergeArm(target: PullRequestTarget, sha: string): Promise<void> {
  const client = clientOf(target);
  const endpoint = `repos/${target.repo}/issues/${target.pr}/comments`;
  const previous = await client.list(endpoint);
  const posted = (await client.send('POST', endpoint, { body: markerBody(sha) })) as {
    id?: number;
  } | null;
  if (posted === null) {
    console.warn(`${target.repo}#${target.pr}: could not record the auto-merge arm on ${sha}`);
    return;
  }
  for (const comment of markers((previous ?? []) as IssueComment[])) {
    if (comment.id === posted.id) continue;
    await client.send('DELETE', `repos/${target.repo}/issues/comments/${comment.id}`);
  }
}
