/**
 * The `ci` title a Dependabot PR that bumps a CI-sensitive linter or formatter
 * should carry: the title the sensitive-bump rule demands. Dependabot can't set
 * that type itself (`commit-message.prefix` is per ecosystem, not per group),
 * and this package never renames a PR, so a wrapper (the Action's
 * `retitle-dependabot-ci`, or a hosted App) applies it, opt-in, before the
 * checks run. Moved here from rmartz/pr-policy-action so every wrapper agrees.
 *
 * It reuses the title check's own detection and grammar, so the retitle and the
 * block can never disagree about which bumps count or what a type is.
 */
import { DEPENDABOT_LOGIN } from '../dependabot/index.js';
import type { PullRequestFacts } from '../../policy.js';
import { isFunctionalType, parseTitle } from './conventional.js';
import { sensitiveBumps } from './sensitive-bump.js';

/**
 * The `ci` title for this PR, or `undefined` to leave the title alone. Only a
 * Dependabot PR with a sensitive bump is retitled, and never one already typed
 * `ci` or a release type: demoting `fix`/`feat`/`perf`/`revert` would cancel a
 * release. Scope, `!` and subject are kept.
 */
export function ciRetitle(
  facts: Pick<PullRequestFacts, 'author' | 'title' | 'manifestChanges'>,
): string | undefined {
  if (facts.author?.login !== DEPENDABOT_LOGIN) return undefined;
  const title = parseTitle(facts.title);
  if (title === null || title.type === 'ci' || isFunctionalType(title.type)) {
    return undefined;
  }
  if (sensitiveBumps(facts.manifestChanges).length === 0) return undefined;
  return `ci${facts.title.slice(title.type.length)}`;
}
