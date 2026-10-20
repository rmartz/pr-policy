/**
 * What kind of file a changed path is, judged from the path and, for a workflow
 * or a manifest, from both sides of its content. One definition backs every
 * check that sorts paths: the UAT gate's trivial-path exemptions and the title
 * check's `chore` and `ci` rules. Keep them reading the same kinds, so a path is
 * never harmless to one check and product code to another.
 */
import { asRecord, deepEqual } from './ci-change/structure.js';
import type { FileChange, PullRequestFacts } from '../policy.js';
import {
  CI_SENSITIVE_PACKAGES,
  DEPENDENCY_FIELDS,
  isManifestPath,
  manifestVersions,
} from './title/sensitive-bump.js';
import { isShippedReusableWorkflow } from './title/workflow-change.js';
import { isTestPath } from './test-paths.js';

export const PATH_KINDS = [
  'docs',
  'tests',
  'ci',
  'tooling-config',
  'lockfile',
  'tooling-manifest',
  'runtime-manifest',
  'metadata',
] as const;
export type PathKind = (typeof PATH_KINDS)[number];

/** What a path kind reads from beyond the path itself. */
export type PathContext = Pick<PullRequestFacts, 'workflowChanges' | 'manifestChanges'>;

export const LOCKFILES = new Set([
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

const ROOT_METADATA =
  /^(LICEN[CS]E|COPYING)(\..+)?$|^CODEOWNERS$|^\.(gitignore|gitattributes|editorconfig)$/;

/**
 * Linter, formatter, test-runner, and repo-tooling config, by file name at any
 * depth. None of it ships, but it can change what a check lets through, so the
 * UAT gate doesn't exempt it; `ci` may change it. Build and app config
 * (`tsconfig.json`, `next.config.*`, bundler config) is deliberately absent: it
 * changes what ships.
 */
const TOOLING_CONFIG = new RegExp(
  [
    String.raw`^eslint\.config\.[cm]?[jt]s$`,
    String.raw`^\.eslintrc(\..+)?$`,
    String.raw`^\.eslintignore$`,
    String.raw`^prettier\.config\.[cm]?[jt]s$`,
    String.raw`^\.prettierrc(\..+)?$`,
    String.raw`^\.prettierignore$`,
    String.raw`^(vitest|jest|playwright|cypress)\.config\.[cm]?[jt]s$`,
    String.raw`^vitest\.workspace\.[cm]?[jt]s$`,
    String.raw`^\.?ruff\.toml$`,
    String.raw`^\.flake8$`,
    String.raw`^\.?pylintrc$`,
    String.raw`^\.?mypy\.ini$`,
    String.raw`^pytest\.ini$`,
    String.raw`^\.coveragerc$`,
    String.raw`^\.markdownlint(-cli2)?(\..+)?$`,
    String.raw`^\.yamllint(\..+)?$`,
    String.raw`^\.pre-commit-config\.ya?ml$`,
    String.raw`^\.repo-hygiene\.ya?ml$`,
    String.raw`^\.releaserc(\..+)?$`,
    String.raw`^release\.config\.[cm]?[jt]s$`,
    String.raw`^commitlint\.config\.[cm]?[jt]s$`,
    String.raw`^\.commitlintrc(\..+)?$`,
    String.raw`^\.lintstagedrc(\..+)?$`,
    String.raw`^lint-staged\.config\.[cm]?[jt]s$`,
    String.raw`^\.?codecov\.ya?ml$`,
  ].join('|'),
);

/** Dependency requirement files that hold only development and tooling pins. */
const DEV_REQUIREMENTS_FILE = /^requirements[-_.](dev|test|tests|lint|ci)([-_.][\w.-]*)?\.txt$/;

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function isLockfile(path: string): boolean {
  return LOCKFILES.has(basename(path));
}

/**
 * The names of the dependencies whose version spec differs between the two
 * sides, read the way the title check reads manifests. `undefined` when either
 * side is missing or won't parse.
 */
function changedDependencies(change: FileChange): string[] | undefined {
  if (change.baseText === undefined || change.headText === undefined) return undefined;
  const before = manifestVersions(change.path, change.baseText);
  const after = manifestVersions(change.path, change.headText);
  if (before === null || after === null) return undefined;
  const names = new Set([...before.keys(), ...after.keys()]);
  return [...names].filter((name) => before.get(name) !== after.get(name));
}

function parseRecord(text: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/**
 * How far a `package.json` change reaches: `tooling` when only
 * `devDependencies`, `packageManager`, or a CI-sensitive tool's version changed;
 * `runtime` when other dependency blocks changed too; `undefined` when anything
 * outside the dependency blocks changed (`scripts`, `exports`,
 * `pnpm.overrides`), or a side is missing or won't parse.
 */
function packageJsonScope(change: FileChange): 'tooling' | 'runtime' | undefined {
  if (change.baseText === undefined || change.headText === undefined) return undefined;
  const before = parseRecord(change.baseText);
  const after = parseRecord(change.headText);
  if (before === undefined || after === undefined) return undefined;
  const without = (record: Record<string, unknown>, fields: readonly string[]) => {
    const rest = { ...record };
    for (const field of fields) delete rest[field];
    return rest;
  };
  const versionFields = [...DEPENDENCY_FIELDS, 'packageManager'];
  if (!deepEqual(without(before, versionFields), without(after, versionFields))) return undefined;
  const runtimeFields = DEPENDENCY_FIELDS.filter((field) => field !== 'devDependencies');
  const sensitive = new Set<string>(CI_SENSITIVE_PACKAGES);
  for (const field of runtimeFields) {
    const was = asRecord(before[field]) ?? {};
    const now = asRecord(after[field]) ?? {};
    const names = new Set([...Object.keys(was), ...Object.keys(now)]);
    for (const name of names) {
      if (!deepEqual(was[name], now[name]) && !sensitive.has(name)) return 'runtime';
    }
  }
  return 'tooling';
}

/**
 * How far a `requirements*.txt` change reaches. A requirements file holds only
 * pins, so it is always a dependency change: `tooling` when the file is a
 * dev/test/lint requirements file or every changed pin is a CI-sensitive tool,
 * else `runtime`. A file whose contents weren't read is `runtime`.
 */
function requirementsScope(change: FileChange | undefined): 'tooling' | 'runtime' {
  if (change === undefined) return 'runtime';
  if (DEV_REQUIREMENTS_FILE.test(basename(change.path))) return 'tooling';
  const changed = changedDependencies(change);
  const sensitive = new Set<string>(CI_SENSITIVE_PACKAGES);
  return changed !== undefined && changed.every((name) => sensitive.has(name))
    ? 'tooling'
    : 'runtime';
}

function manifestKind(path: string, context: PathContext): PathKind | undefined {
  const change = context.manifestChanges.find((file) => file.path === path);
  if (basename(path) !== 'package.json') {
    return requirementsScope(change) === 'tooling' ? 'tooling-manifest' : 'runtime-manifest';
  }
  if (change === undefined) return undefined;
  const scope = packageJsonScope(change);
  if (scope === undefined) return undefined;
  return scope === 'tooling' ? 'tooling-manifest' : 'runtime-manifest';
}

/** The kind of a changed path, or `undefined` when it is (or may be) product code. */
export function pathKind(path: string, context: PathContext): PathKind | undefined {
  const parts = path.split('/');
  const name = parts.at(-1) ?? '';

  if (name.endsWith('.md') || parts[0] === 'docs') return 'docs';
  if (isTestPath(path)) return 'tests';
  if (path.startsWith('.github/workflows/') || path.startsWith('.github/actions/')) {
    // A shipped reusable workflow is the product consumers call, not this repo's CI.
    const change = context.workflowChanges.find((file) => file.path === path);
    return change !== undefined && isShippedReusableWorkflow(change) ? undefined : 'ci';
  }
  if (LOCKFILES.has(name)) return 'lockfile';
  if (isManifestPath(path)) return manifestKind(path, context);
  if (parts[0] === '.github' || parts[0] === '.vscode') return 'metadata';
  if (parts.length === 1 && ROOT_METADATA.test(name)) return 'metadata';
  if (TOOLING_CONFIG.test(name)) return 'tooling-config';
  return undefined;
}
