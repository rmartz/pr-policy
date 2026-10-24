/**
 * The GitHub side of an evaluation: gather a PR's facts and apply the label
 * edits checks planned (the check-run itself is posted by ./check-run.ts).
 * Everything goes through the target's `GitHubClient` (./client.ts): the
 * vendored `gh` transport by default, or a token-backed fetch client.
 */
import { isWorkflowPath } from '../checks/ci-change/workflow-paths.js';
import { HEAD_BOUND_SIGN_OFFS } from '../checks/uat/index.js';
import { isManifestPath } from '../checks/title/sensitive-bump.js';
import type { PolicyEvaluation } from '../evaluate.js';
import type { ClientTarget } from './client.js';
import { clientOf } from './client.js';
import type { FileChange, OpenPullRequest, PullRequestBase, PullRequestFacts } from '../policy.js';
import { gatherHeadPushedAt } from './head-push.js';
import { gatherSignOffStatus } from './sign-off-status.js';
import { gatherSignOffs } from './sign-offs.js';

export interface PullRequestTarget extends ClientTarget {
  repo: string;
  pr: number;
}

interface PrApiShape {
  title: string;
  body: string | null;
  draft: boolean;
  user: { login: string; type: string };
  head: { sha: string };
  base: { ref: string; repo: { default_branch: string } };
  labels: { name: string }[];
}

interface ChangedFile {
  filename: string;
  status: string;
  /** Absent (or `null`) when the file was not renamed. */
  previous_filename?: string | null;
}

async function getJson<T>(target: PullRequestTarget, path: string): Promise<T> {
  const out = await clientOf(target).getJson(path);
  if (out === null) throw new Error(`GitHub call failed: GET ${path}`);
  return out as T;
}

/**
 * One file's raw text at a ref. Only called for a side the file list says
 * exists, so a failed read throws: treating it as "absent" would make a
 * modified workflow look newly added, and a new workflow is never a loosening.
 */
async function blob(target: PullRequestTarget, path: string, ref: string): Promise<string> {
  const out = await clientOf(target).getRaw(
    `repos/${target.repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
  );
  if (out === null) throw new Error(`could not read ${path} at ${ref}`);
  return out;
}

async function listFiles(target: PullRequestTarget): Promise<ChangedFile[]> {
  const out = await clientOf(target).list(`repos/${target.repo}/pulls/${target.pr}/files`);
  if (out === null) throw new Error(`could not list files of ${target.repo}#${target.pr}`);
  return out as ChangedFile[];
}

/**
 * The PR's base branch and the open PRs it heads. A stacked base is read from
 * the PR that heads it, since GitHub has no branch-level labels. The default
 * branch is never looked up. A failed lookup throws: an empty list would read as
 * "no PR heads this branch".
 */
async function gatherBase(target: PullRequestTarget, view: PrApiShape): Promise<PullRequestBase> {
  const branch = view.base.ref;
  const defaultBranch = view.base.repo.default_branch;
  if (branch === defaultBranch) return { branch, defaultBranch, headOf: [] };
  // A base branch always lives in the base repo, so its owner qualifies the head.
  const head = encodeURIComponent(`${target.repo.split('/')[0] ?? ''}:${branch}`);
  const out = await clientOf(target).list(
    `repos/${target.repo}/pulls?state=open&head=${head}&per_page=100`,
  );
  if (out === null) throw new Error(`could not list the open PRs heading ${branch}`);
  const headOf = (out as { number: number; labels: { name: string }[] }[]).map(
    (pull): OpenPullRequest => ({
      number: pull.number,
      labels: pull.labels.map((label) => label.name),
    }),
  );
  return { branch, defaultBranch, headOf };
}

/**
 * Gather everything the checks judge. Workflow files and dependency manifests
 * are read at the **merge base**, not the base tip, so a change merged into the
 * base after this PR branched is not attributed to it.
 */
export async function gatherFacts(
  pullRequest: PullRequestTarget,
): Promise<{ facts: PullRequestFacts; headSha: string }> {
  const target = { ...pullRequest, client: clientOf(pullRequest) };
  const view = await getJson<PrApiShape>(target, `repos/${target.repo}/pulls/${target.pr}`);
  const headSha = view.head.sha;
  const files = await listFiles(target);
  const touches = (predicate: (path: string) => boolean) =>
    files.filter((file) => predicate(file.filename) || predicate(file.previous_filename ?? ''));
  const workflowFiles = touches(isWorkflowPath);
  const manifestFiles = touches(isManifestPath);

  let workflowChanges: FileChange[] = [];
  let manifestChanges: FileChange[] = [];
  if (workflowFiles.length > 0 || manifestFiles.length > 0) {
    const comparison = await getJson<{ merge_base_commit: { sha: string } }>(
      target,
      `repos/${target.repo}/compare/${view.base.ref}...${headSha}`,
    );
    const mergeBase = comparison.merge_base_commit.sha;
    const read = async (file: ChangedFile): Promise<FileChange> => ({
      path: file.filename,
      baseText:
        file.status === 'added'
          ? undefined
          : await blob(target, file.previous_filename ?? file.filename, mergeBase),
      headText: file.status === 'removed' ? undefined : await blob(target, file.filename, headSha),
    });
    workflowChanges = await Promise.all(workflowFiles.map(read));
    manifestChanges = await Promise.all(manifestFiles.map(read));
  }

  const labels = view.labels.map((label) => label.name);
  const facts: PullRequestFacts = {
    title: view.title,
    body: view.body ?? '',
    author: { login: view.user.login, type: view.user.type },
    base: await gatherBase(target, view),
    draft: view.draft,
    labels,
    // A rename's old path counts too: moving code into docs/ is not docs-only.
    changedFiles: files.flatMap((file) =>
      file.previous_filename === undefined || file.previous_filename === null
        ? [file.filename]
        : [file.previous_filename, file.filename],
    ),
    workflowChanges,
    manifestChanges,
    signOffs: await gatherSignOffs(target, labels),
  };
  // Only a head-bound sign-off needs the push time, so most PRs skip the reads.
  if (HEAD_BOUND_SIGN_OFFS.some((label) => labels.includes(label))) {
    const pushedAt = await gatherHeadPushedAt(target, headSha);
    if (pushedAt !== undefined) facts.headPushedAt = pushedAt;
  }
  const signOffStatus = await gatherSignOffStatus(target, headSha);
  if (signOffStatus !== undefined) facts.signOffStatus = signOffStatus;
  return { facts, headSha };
}

/**
 * The open PRs whose head is `sha`. A `status` event carries a SHA, not a PR,
 * so this is how a caller re-evaluates when pr-lifecycle posts its sign-off
 * status. A PR whose head has since moved isn't returned: its newer head gets
 * its own status. A failed lookup throws.
 */
export async function openPullRequestsAtHead(
  target: ClientTarget & { repo: string },
  sha: string,
): Promise<number[]> {
  const endpoint = `repos/${target.repo}/commits/${sha}/pulls`;
  const out = await clientOf(target).list(endpoint);
  if (out === null) throw new Error(`could not read ${endpoint}`);
  return (out as { number: number; state: string; head: { sha: string } }[])
    .filter((pull) => pull.state === 'open' && pull.head.sha === sha)
    .map((pull) => pull.number);
}

/** Apply the label edits the checks planned (labels this package owns). */
export async function applyLabelEdits(
  target: PullRequestTarget,
  evaluation: PolicyEvaluation,
): Promise<void> {
  const client = clientOf(target);
  if (evaluation.labelsToAdd.length > 0) {
    await client.addLabels(target.repo, target.pr, evaluation.labelsToAdd);
  }
  for (const label of evaluation.labelsToRemove) {
    await client.removeLabel(target.repo, target.pr, label);
  }
}
