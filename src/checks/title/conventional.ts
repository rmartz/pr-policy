/**
 * The Conventional-Commit grammar a squash subject must satisfy. It mirrors the
 * fleet's `pr-title-lint.yml` and `commit-convention.yml` exactly, so a title
 * this accepts is one the post-merge tripwire accepts too.
 */

export const COMMIT_TYPES = [
  'feat',
  'fix',
  'docs',
  'chore',
  'refactor',
  'test',
  'style',
  'perf',
  'ci',
  'build',
  'revert',
] as const;
export type CommitType = (typeof COMMIT_TYPES)[number];

/**
 * The only types that may carry `!`. Under semantic-release `!` cuts a major, so
 * it is reserved for shippable functional change (rmartz/dotfiles#1559).
 */
export const FUNCTIONAL_TYPES = [
  'feat',
  'fix',
  'perf',
  'revert',
] as const satisfies readonly CommitType[];

export interface ParsedTitle {
  type: CommitType;
  scope?: string;
  breaking: boolean;
  subject: string;
}

// `<type>[(<scope>)][!]: <subject>` — the `!` goes after the scope, as the lint
// and the tripwire require.
const TITLE = /^([a-z]+)(?:\(([^)]+)\))?(!)?: (\S.*)$/;

function isCommitType(value: string): value is CommitType {
  return (COMMIT_TYPES as readonly string[]).includes(value);
}

/** Parse a title, or `null` when it is not a valid Conventional Commit. */
export function parseTitle(title: string): ParsedTitle | null {
  const match = TITLE.exec(title);
  const [, type, scope, bang, subject] = match ?? [];
  if (type === undefined || subject === undefined || !isCommitType(type)) return null;
  return { type, scope, breaking: bang === '!', subject };
}

export function isFunctionalType(type: CommitType): boolean {
  return (FUNCTIONAL_TYPES as readonly string[]).includes(type);
}

// release-please's default title pattern: `chore${scope}: release${component} ${version}`.
const RELEASE_PLEASE_TITLE = /^chore(\([^)]*\))?!?:\s+release\b/;

/**
 * Whether this is a release-please release PR. Its title is a contract with
 * release-please, which must parse its own merged release PR, so no title rule
 * applies to it (rmartz/dotfiles#1542).
 */
export function isReleasePleaseTitle(title: string): boolean {
  return RELEASE_PLEASE_TITLE.test(title);
}
