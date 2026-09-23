/**
 * The GitHub side of an evaluation: gather a PR's facts, post the one
 * `pr-policy` check-run, and apply the label edits checks planned. Everything
 * goes through the vendored `gh` transport in src/lib/.
 */
import { isWorkflowPath } from '../checks/ci-change/workflow-paths.js';
import { PR_POLICY_CHECK_NAME } from '../contract.js';
import type { PolicyEvaluation } from '../evaluate.js';
import { addLabels, ghCall, removeLabel } from '../lib/github.js';
import type { FileChange, PullRequestFacts } from '../policy.js';

export interface PullRequestTarget {
  repo: string;
  pr: number;
  cwd?: string;
}

interface PrApiShape {
  title: string;
  head: { sha: string };
  base: { ref: string };
  labels: { name: string }[];
}

interface ChangedFile {
  filename: string;
  status: string;
  previous_filename?: string;
}

async function ghJson<T>(target: PullRequestTarget, argv: string[]): Promise<T> {
  const out = await ghCall({ argv }, null, { cwd: target.cwd });
  if (out === null) throw new Error(`gh call failed: ${argv.join(' ')}`);
  return JSON.parse(out) as T;
}

/**
 * One file's raw text at a ref. Only called for a side the file list says
 * exists, so a failed read throws: treating it as "absent" would make a
 * modified workflow look newly added, and a new workflow is never a loosening.
 */
async function blob(target: PullRequestTarget, path: string, ref: string): Promise<string> {
  const out = await ghCall(
    {
      argv: [
        'gh',
        'api',
        '-H',
        'Accept: application/vnd.github.raw',
        `repos/${target.repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
      ],
    },
    null,
    { cwd: target.cwd },
  );
  if (out === null) throw new Error(`could not read ${path} at ${ref}`);
  return out;
}

async function listFiles(target: PullRequestTarget): Promise<ChangedFile[]> {
  const out = await ghCall(
    {
      argv: [
        'gh',
        'api',
        '--paginate',
        `repos/${target.repo}/pulls/${target.pr}/files`,
        '--jq',
        '.[] | {filename, status, previous_filename}',
      ],
    },
    null,
    { cwd: target.cwd },
  );
  if (out === null) throw new Error(`could not list files of ${target.repo}#${target.pr}`);
  return out
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as ChangedFile);
}

/**
 * Gather everything the checks judge. Workflow files are read at the **merge
 * base**, not the base tip, so a change merged into the base after this PR
 * branched is not attributed to it.
 */
export async function gatherFacts(
  target: PullRequestTarget,
): Promise<{ facts: PullRequestFacts; headSha: string }> {
  const view = await ghJson<PrApiShape>(target, [
    'gh',
    'api',
    `repos/${target.repo}/pulls/${target.pr}`,
  ]);
  const headSha = view.head.sha;
  const files = await listFiles(target);
  const workflowFiles = files.filter(
    (file) => isWorkflowPath(file.filename) || isWorkflowPath(file.previous_filename ?? ''),
  );

  const workflowChanges: FileChange[] = [];
  if (workflowFiles.length > 0) {
    const comparison = await ghJson<{ merge_base_commit: { sha: string } }>(target, [
      'gh',
      'api',
      `repos/${target.repo}/compare/${view.base.ref}...${headSha}`,
    ]);
    const mergeBase = comparison.merge_base_commit.sha;
    for (const file of workflowFiles) {
      const basePath = file.previous_filename ?? file.filename;
      workflowChanges.push({
        path: file.filename,
        baseText: file.status === 'added' ? undefined : await blob(target, basePath, mergeBase),
        headText:
          file.status === 'removed' ? undefined : await blob(target, file.filename, headSha),
      });
    }
  }

  const facts: PullRequestFacts = {
    title: view.title,
    labels: view.labels.map((label) => label.name),
    changedFiles: files.map((file) => file.filename),
    workflowChanges,
  };
  return { facts, headSha };
}

/** Post the one `pr-policy` check-run on the head commit. */
export async function postCheckRun(
  target: PullRequestTarget,
  headSha: string,
  evaluation: PolicyEvaluation,
): Promise<void> {
  const payload = {
    name: PR_POLICY_CHECK_NAME,
    head_sha: headSha,
    status: 'completed',
    conclusion: evaluation.conclusion,
    completed_at: new Date().toISOString(),
    output: { title: evaluation.title, summary: evaluation.summary },
  };
  const out = await ghCall(
    {
      argv: ['gh', 'api', '-X', 'POST', `repos/${target.repo}/check-runs`, '--input', '-'],
      stdin: JSON.stringify(payload),
    },
    null,
    { cwd: target.cwd },
  );
  if (out === null) throw new Error(`could not post the ${PR_POLICY_CHECK_NAME} check-run`);
}

/** Apply the label edits the checks planned (labels this package owns). */
export async function applyLabelEdits(
  target: PullRequestTarget,
  evaluation: PolicyEvaluation,
): Promise<void> {
  if (evaluation.labelsToAdd.length > 0) {
    await addLabels(target.repo, target.pr, evaluation.labelsToAdd, { cwd: target.cwd });
  }
  for (const label of evaluation.labelsToRemove) {
    await removeLabel(target.repo, target.pr, label, { cwd: target.cwd });
  }
}
