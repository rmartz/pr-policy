/**
 * Detects a version change to a CI-sensitive linter or formatter. A new
 * black/ruff/prettier/eslint/pylint can change results on files a PR never
 * touched, so every in-flight PR must re-test against it — which the
 * coordinator keys off the `ci` type. Comparison is structural: each manifest is
 * parsed on both sides and the declared versions compared.
 */
import type { FileChange } from '../../policy.js';

export const CI_SENSITIVE_PACKAGES = ['eslint', 'black', 'pylint', 'ruff', 'prettier'] as const;

const REQUIREMENTS_FILE = /^requirements[\w.-]*\.txt$/;

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Whether a path is a dependency manifest the title check reads. */
export function isManifestPath(path: string): boolean {
  if (path.split('/').includes('node_modules')) return false;
  const name = basename(path);
  return name === 'package.json' || REQUIREMENTS_FILE.test(name);
}

/** PEP 503-style name normalization, so `Black` and `black` compare equal. */
function normalize(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[-_.]+/g, '-');
}

export const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

/** Declared version spec by package name, or `null` when the file won't parse. */
function npmVersions(text: string): Map<string, string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const versions = new Map<string, string>();
  if (typeof parsed !== 'object' || parsed === null) return versions;
  for (const field of DEPENDENCY_FIELDS) {
    const block = (parsed as Record<string, unknown>)[field];
    if (typeof block !== 'object' || block === null) continue;
    for (const [name, spec] of Object.entries(block)) {
      if (typeof spec === 'string') versions.set(name, spec);
    }
  }
  return versions;
}

const REQUIREMENT_LINE = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*((?:==|~=|>=|<=|!=|<|>).*)$/;

function pipVersions(text: string): Map<string, string> {
  const versions = new Map<string, string>();
  for (const line of text.split('\n')) {
    const [, name, spec] = REQUIREMENT_LINE.exec(line.replace(/#.*/, '')) ?? [];
    if (name !== undefined && spec !== undefined) versions.set(normalize(name), spec.trim());
  }
  return versions;
}

function versionsOf(path: string, text: string): Map<string, string> | null {
  return basename(path) === 'package.json' ? npmVersions(text) : pipVersions(text);
}

/**
 * The CI-sensitive packages whose declared version changed between the two
 * sides of any manifest. A package only added or only removed is not a bump.
 */
export function sensitiveBumps(changes: readonly FileChange[]): string[] {
  const bumped = new Set<string>();
  for (const change of changes) {
    if (change.baseText === undefined || change.headText === undefined) continue;
    const before = versionsOf(change.path, change.baseText);
    const after = versionsOf(change.path, change.headText);
    if (before === null || after === null) continue;
    for (const name of CI_SENSITIVE_PACKAGES) {
      const was = before.get(name);
      const now = after.get(name);
      if (was !== undefined && now !== undefined && was !== now) bumped.add(name);
    }
  }
  return [...bumped];
}
