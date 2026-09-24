/**
 * Which PRs can't need UAT, judged from their changed paths alone. These rules
 * only ever **exempt**: a PR is trivial when every path it touches falls in an
 * exempt category, and a single path outside them leaves the gate holding. They
 * never add a requirement; the review agent's judgment, expressed through the
 * labels, covers that. Replay against merged fleet PRs is recorded in
 * docs/checks/uat.md.
 */
import { asRecord, deepEqual } from '../ci-change/structure.js';
import type { FileChange, PullRequestFacts } from '../../policy.js';
import { DEPENDENCY_FIELDS, isManifestPath } from '../title/sensitive-bump.js';
import { isShippedReusableWorkflow } from '../title/workflow-change.js';

export const TRIVIAL_CATEGORIES = ['docs', 'tests', 'ci', 'dependencies', 'metadata'] as const;
export type TrivialCategory = (typeof TRIVIAL_CATEGORIES)[number];

const TEST_DIRS = new Set(['test', 'tests', '__tests__', '__snapshots__', '__mocks__', 'e2e']);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$|^test_.*\.py$|_test\.py$|^conftest\.py$/;

const LOCKFILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'poetry.lock',
  'uv.lock',
  'Pipfile.lock',
  'Cargo.lock',
  'go.sum',
]);

const ROOT_METADATA = /^(LICEN[CS]E|COPYING)(\..+)?$|^CODEOWNERS$|^\.(gitignore|gitattributes|editorconfig)$/;

/**
 * Whether a `package.json` change touches only dependency versions: the
 * dependency blocks and `packageManager` may differ, and nothing else. A change
 * to `scripts`, `exports`, or `pnpm.overrides` can change what ships, so it
 * doesn't qualify. An added, deleted, or unparseable manifest doesn't either.
 */
function isDependencyOnlyManifest(change: FileChange | undefined): boolean {
  if (change?.baseText === undefined || change.headText === undefined) return false;
  const strip = (text: string): unknown => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return undefined;
    }
    const record = asRecord(parsed);
    if (record === undefined) return undefined;
    const rest = { ...record };
    for (const field of [...DEPENDENCY_FIELDS, 'packageManager']) delete rest[field];
    return rest;
  };
  const before = strip(change.baseText);
  const after = strip(change.headText);
  return before !== undefined && after !== undefined && deepEqual(before, after);
}

function categoryOf(path: string, pr: PullRequestFacts): TrivialCategory | undefined {
  const parts = path.split('/');
  const name = parts[parts.length - 1] ?? '';
  const dirs = parts.slice(0, -1);

  if (name.endsWith('.md') || parts[0] === 'docs') return 'docs';
  if (dirs.some((dir) => TEST_DIRS.has(dir)) || TEST_FILE.test(name)) return 'tests';
  if (path.startsWith('.github/workflows/') || path.startsWith('.github/actions/')) {
    // A shipped reusable workflow is the product consumers call, not this repo's CI.
    const change = pr.workflowChanges.find((file) => file.path === path);
    return change !== undefined && isShippedReusableWorkflow(change) ? undefined : 'ci';
  }
  if (LOCKFILES.has(name)) return 'dependencies';
  if (isManifestPath(path)) {
    if (name !== 'package.json') return 'dependencies'; // requirements*.txt holds only pins
    const change = pr.manifestChanges.find((file) => file.path === path);
    return isDependencyOnlyManifest(change) ? 'dependencies' : undefined;
  }
  if (parts[0] === '.github' || parts[0] === '.vscode') return 'metadata';
  if (parts.length === 1 && ROOT_METADATA.test(name)) return 'metadata';
  return undefined;
}

/**
 * The exempt categories this PR's paths fall in, or `undefined` when any path
 * falls outside them. A PR that touches no files is trivially exempt.
 */
export function trivialCategories(pr: PullRequestFacts): TrivialCategory[] | undefined {
  const found = new Set<TrivialCategory>();
  for (const path of pr.changedFiles) {
    const category = categoryOf(path, pr);
    if (category === undefined) return undefined;
    found.add(category);
  }
  return TRIVIAL_CATEGORIES.filter((category) => found.has(category));
}
