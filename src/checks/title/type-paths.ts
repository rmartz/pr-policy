/**
 * Type-versus-paths rules: a non-releasing type promises something about what
 * the PR touches, and a title that breaks that promise either hides a change
 * from the release or hides a change in the tests that judge it. `docs` may
 * change only Markdown, `test` only tests and Markdown, `refactor` no tests at
 * all, `chore` nothing that can change what ships, and `ci` only CI and
 * tooling. Markdown is always docs, even under a test directory.
 */
import { pathKind, type PathContext, type PathKind } from '../path-kinds.js';
import { isTestPath } from '../test-paths.js';
import type { CommitType } from './conventional.js';

export function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

/** The facts a type-versus-paths rule reads. */
export type TypePathFacts = PathContext & { changedFiles: readonly string[] };

/** Path kinds that can't change what ships: the UAT gate's trivial categories. */
const CHORE_KINDS: ReadonlySet<PathKind> = new Set([
  'docs',
  'tests',
  'ci',
  'lockfile',
  'tooling-manifest',
  'metadata',
]);

/**
 * Path kinds a CI or tooling change may touch. A CI-sensitive tool's version
 * bump is a `tooling-manifest`, so the `ci(deps):` retitle the sensitive-bump
 * rule asks for always passes here. Tests never ship, and a CI change often
 * updates a test that pins workflow behaviour, so they are allowed too.
 */
const CI_KINDS: ReadonlySet<PathKind> = new Set([
  'docs',
  'tests',
  'ci',
  'tooling-config',
  'lockfile',
  'tooling-manifest',
  'metadata',
]);

const quote = (paths: readonly string[]): string => {
  const shown = paths.slice(0, 5).map((path) => `\`${path}\``);
  if (paths.length > 5) shown.push(`and ${paths.length - 5} more`);
  return shown.join(', ');
};

function outside(
  paths: readonly string[],
  facts: TypePathFacts,
  allowed: ReadonlySet<PathKind>,
): string[] {
  return paths.filter((path) => {
    const kind = pathKind(path, facts);
    return kind === undefined || !allowed.has(kind);
  });
}

/** The blocking message for a type whose changed paths contradict it, if any. */
export function typePathViolation(type: CommitType, facts: TypePathFacts): string | undefined {
  const paths = [...new Set(facts.changedFiles)];
  if (type === 'docs') {
    const offending = paths.filter((path) => !isMarkdownPath(path));
    if (offending.length === 0) return undefined;
    return `A \`docs\` PR may change only Markdown files, but this one changes ${quote(offending)}. \`docs\` doesn't release, so that change would never ship. Retitle to the type of the non-docs change, or split it into its own PR.`;
  }
  if (type === 'refactor') {
    // Markdown under a test directory is documentation, not a test.
    const offending = paths.filter((path) => isTestPath(path) && !isMarkdownPath(path));
    if (offending.length === 0) return undefined;
    return `A \`refactor\` PR must leave the tests untouched, so they can confirm behaviour is unchanged, but this one changes ${quote(offending)}. Land the test changes first as a \`test:\` PR, then refactor against them.`;
  }
  if (type === 'test') {
    const offending = paths.filter((path) => !isTestPath(path) && !isMarkdownPath(path));
    if (offending.length === 0) return undefined;
    return `A \`test\` PR may change only test files and docs, so it locks in current behaviour without changing it, but this one changes ${quote(offending)}. \`test\` doesn't release, so that change would never ship. Retitle to the type of the non-test change, or split it into its own PR.`;
  }
  if (type === 'chore') {
    const offending = outside(paths, facts, CHORE_KINDS);
    if (offending.length === 0) return undefined;
    return `A \`chore\` PR may change only files that can't change what ships (docs, tests, CI, lockfiles, dev-dependency versions, and repo metadata), but this one changes ${quote(offending)}. A \`package.json\` counts only when nothing but dev-dependency versions changed. \`chore\` doesn't release and needs no UAT, so that change would ship untested in someone else's release. Retitle to the type of that change, or split it into its own PR.`;
  }
  if (type === 'ci') {
    const offending = outside(paths, facts, CI_KINDS);
    if (offending.length === 0) return undefined;
    return `A \`ci\` PR may change only CI and tooling (\`.github/\`, linter, formatter, and test-runner config, lockfiles, dev-tool versions, and docs), but this one changes ${quote(offending)}. A \`package.json\` counts only when nothing but dev-dependency or lint/format tool versions changed. \`ci\` doesn't release and needs no UAT, so that change would ship untested in someone else's release. Retitle to the type of that change, or split it into its own PR.`;
  }
  return undefined;
}
