/**
 * Type-versus-paths rules: a non-releasing type promises something about what
 * the PR touches, and a title that breaks that promise either hides a change
 * from the release or hides a change in the tests that judge it. `docs` may
 * change only Markdown, `test` only tests, and `refactor` no tests at all.
 */
import type { CommitType } from './conventional.js';

const TEST_DIRS = new Set(['test', 'tests', '__tests__']);
const TEST_FILE = /\.(test|spec)\.[^/]+$|^test_[^/]*\.py$|_test\.(py|go)$/;

export function isMarkdownPath(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

export function isTestPath(path: string): boolean {
  const parts = path.split('/');
  const name = parts.at(-1) ?? '';
  return parts.slice(0, -1).some((dir) => TEST_DIRS.has(dir)) || TEST_FILE.test(name);
}

const quote = (paths: readonly string[]): string => {
  const shown = paths.slice(0, 5).map((path) => `\`${path}\``);
  if (paths.length > 5) shown.push(`and ${paths.length - 5} more`);
  return shown.join(', ');
};

/** The blocking message for a type whose changed paths contradict it, if any. */
export function typePathViolation(
  type: CommitType,
  changedFiles: readonly string[],
): string | undefined {
  const paths = [...new Set(changedFiles)];
  if (type === 'docs') {
    const offending = paths.filter((path) => !isMarkdownPath(path));
    if (offending.length === 0) return undefined;
    return `A \`docs\` PR may change only Markdown files, but this one changes ${quote(offending)}. \`docs\` doesn't release, so that change would never ship. Retitle to the type of the non-docs change, or split it into its own PR.`;
  }
  if (type === 'refactor') {
    const offending = paths.filter(isTestPath);
    if (offending.length === 0) return undefined;
    return `A \`refactor\` PR must leave the tests untouched, so they can confirm behaviour is unchanged, but this one changes ${quote(offending)}. Land the test changes first as a \`test:\` PR, then refactor against them.`;
  }
  if (type === 'test') {
    const offending = paths.filter((path) => !isTestPath(path));
    if (offending.length === 0) return undefined;
    return `A \`test\` PR may change only test files, so it locks in current behaviour without changing it, but this one changes ${quote(offending)}. \`test\` doesn't release, so that change would never ship. Retitle to the type of the non-test change, or split it into its own PR.`;
  }
  return undefined;
}
