/**
 * Which human sign-off a PR needs, if any. This is the one definition both the
 * gate (the `uat` and `ci-change` checks here) and the label writer
 * (rmartz/pr-lifecycle) call, so the labels a PR shows and the gate that holds
 * it can't disagree. Neither trusts the other's output: each computes the
 * answer from the PR's facts and the repo config.
 *
 * - `none`: UAT is off for the repo, or the PR is statically safe. That is a
 *   `docs`, `test`, or `refactor` title (each path-checked by the title rules),
 *   or every changed path in a trivial category (./checks/uat/trivial.ts).
 * - `ci`: a `ci` PR that loosens a workflow. A person signs it off with
 *   `CI change approved`, and is never also asked for UAT.
 * - `uat`: everything else, including `chore`, which the review judges.
 *
 * Pure: no I/O. See docs/checks/uat.md.
 */
import { classifyWorkflowChanges } from './checks/ci-change/classify.js';
import type { Indicator } from './checks/ci-change/indicators.js';
import { parseTitle, type CommitType } from './checks/title/conventional.js';
import { stripWipMarker } from './checks/title/wip.js';
import { trivialCategories } from './checks/uat/trivial.js';
import type { PullRequestFacts } from './policy.js';
import { DEFAULT_REPO_CONFIG, type RepoConfig } from './repo-config.js';

export const SIGN_OFF_REQUIREMENTS = ['none', 'ci', 'uat'] as const;

/** What the sign-off classifier reads from a PR. */
export type SignOffFacts = Pick<
  PullRequestFacts,
  'title' | 'changedFiles' | 'workflowChanges' | 'manifestChanges'
>;

/** The sign-off a PR needs, with a sentence a finding or a label can show. */
export type SignOffRequirement =
  | { kind: 'none'; reason: string }
  | { kind: 'ci'; reason: string; indicators: readonly Indicator[] }
  | { kind: 'uat'; reason: string };

/**
 * Title types that promise no behaviour change, each enforced against its paths
 * by the title check, so the type alone exempts a PR from UAT.
 */
const STATICALLY_SAFE_TYPES: ReadonlySet<CommitType> = new Set(['docs', 'test', 'refactor']);

export function classifySignOff(
  facts: SignOffFacts,
  config: RepoConfig = DEFAULT_REPO_CONFIG,
): SignOffRequirement {
  const type = parseTitle(stripWipMarker(facts.title).title)?.type;

  // A CI sign-off comes first and stands alone: it is a person looking at the
  // change, so asking for UAT too would ask twice. Only a `ci` title qualifies;
  // a loosening bundled into another type is the review's to split out, and
  // until then it needs both.
  if (type === 'ci') {
    const classification = classifyWorkflowChanges(facts.workflowChanges);
    if (classification.verdict === 'loosening') {
      return {
        kind: 'ci',
        reason: 'A `ci` PR that loosens CI needs a person to sign off the CI change.',
        indicators: classification.indicators,
      };
    }
  }

  if (config.uat === 'off') {
    return { kind: 'none', reason: 'No UAT needed: UAT is off for this repo.' };
  }
  if (type !== undefined && STATICALLY_SAFE_TYPES.has(type)) {
    return { kind: 'none', reason: `No UAT needed: a \`${type}\` PR changes no behaviour.` };
  }
  const categories = trivialCategories(facts);
  if (categories !== undefined) {
    const kinds = categories.length > 0 ? categories.join(', ') : 'no files';
    return { kind: 'none', reason: `No UAT needed: the PR changes only ${kinds}.` };
  }
  return { kind: 'uat', reason: 'This PR can change behaviour, so it needs UAT.' };
}
