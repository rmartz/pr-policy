/**
 * Which PRs can't need UAT, judged from their changed paths alone. These rules
 * only ever **exempt**: a PR is trivial when every path it touches falls in an
 * exempt category, and a single path outside them leaves the gate holding. They
 * never add a requirement; the review agent's judgment, expressed through the
 * labels, covers that. The path kinds themselves live in ../path-kinds.ts,
 * shared with the title check. Replay against merged fleet PRs is recorded in
 * docs/checks/uat.md.
 */
import type { PullRequestFacts } from '../../policy.js';
import { pathKind, type PathKind } from '../path-kinds.js';

export const TRIVIAL_CATEGORIES = ['docs', 'tests', 'ci', 'dependencies', 'metadata'] as const;
export type TrivialCategory = (typeof TRIVIAL_CATEGORIES)[number];

/**
 * The UAT category of a path kind. Tooling config can change what a check lets
 * through, so it stays with the review's judgment.
 */
function categoryOf(kind: PathKind | undefined): TrivialCategory | undefined {
  switch (kind) {
    case 'docs':
    case 'tests':
    case 'ci':
    case 'metadata':
      return kind;
    case 'lockfile':
    case 'tooling-manifest':
    case 'runtime-manifest':
      return 'dependencies';
    case 'tooling-config':
    case 'repo-script':
    case undefined:
      return undefined;
  }
}

/**
 * The exempt categories this PR's paths fall in, or `undefined` when any path
 * falls outside them. A PR that touches no files is trivially exempt.
 */
export function trivialCategories(pr: PullRequestFacts): TrivialCategory[] | undefined {
  const found = new Set<TrivialCategory>();
  for (const path of pr.changedFiles) {
    const category = categoryOf(pathKind(path, pr));
    if (category === undefined) return undefined;
    found.add(category);
  }
  return TRIVIAL_CATEGORIES.filter((category) => found.has(category));
}
