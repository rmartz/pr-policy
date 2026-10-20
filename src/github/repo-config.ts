/**
 * Read `.github/pr-policy.yml` from the PR's base branch. The PR head is never
 * read, so a PR can't switch a gate off for itself. Parsing is pure, in
 * ../repo-config.ts.
 */
import { ghCall } from '../lib/github.js';
import {
  parseRepoConfig,
  REPO_CONFIG_LOCATION,
  REPO_CONFIG_PATH,
  type RepoConfigLoad,
} from '../repo-config.js';
import type { PullRequestTarget } from './pull-request.js';

/**
 * Load the repo config as of `baseRef` (the PR's base branch). An absent file
 * means the defaults. A failed read throws rather than silently using the
 * defaults, the same way every other fact read fails loudly.
 */
export async function loadRepoConfig(
  target: Pick<PullRequestTarget, 'repo' | 'cwd'>,
  baseRef: string,
): Promise<RepoConfigLoad> {
  const ref = encodeURIComponent(baseRef);
  const { dir, file } = REPO_CONFIG_LOCATION;
  // List the directory first: `gh` reports a missing file and a failed read the
  // same way, and only the first means "use the defaults".
  const listing = await ghCall(
    { argv: ['gh', 'api', `repos/${target.repo}/contents/${dir}?ref=${ref}`, '--jq', '.[].name'] },
    null,
    { cwd: target.cwd },
  );
  if (listing === null) throw new Error(`could not list ${dir}/ at ${baseRef}`);
  if (!listing.split('\n').includes(file)) return parseRepoConfig(undefined);

  const text = await ghCall(
    {
      argv: [
        'gh',
        'api',
        '-H',
        'Accept: application/vnd.github.raw',
        `repos/${target.repo}/contents/${REPO_CONFIG_PATH}?ref=${ref}`,
      ],
    },
    null,
    { cwd: target.cwd },
  );
  if (text === null) throw new Error(`could not read ${REPO_CONFIG_PATH} at ${baseRef}`);
  return parseRepoConfig(text);
}
