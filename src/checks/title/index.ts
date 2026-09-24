/**
 * Check 2: title-type rules. The repo squash-merges with the PR title, so the
 * title *is* the commit subject that reaches `main` and drives the release.
 * Nothing rewrites it at merge time any more, so an invalid title stays red
 * until the author (or a fix pass) edits it. This package never renames a PR.
 *
 * Ported from rmartz/dotfiles `breaking_change.py` / `lib/breaking_title.py`,
 * where the same rules were applied by rewriting the title at merge.
 */
import {
  BREAKING_CHANGE_LABEL,
  HOTFIX_LABEL,
  RELEASE_PLEASE_PENDING_LABEL,
} from '../../contract.js';
import type { CheckResult, Finding, PolicyCheck, PullRequestFacts } from '../../policy.js';
import {
  COMMIT_TYPES,
  FUNCTIONAL_TYPES,
  isFunctionalType,
  isReleasePleaseTitle,
  parseTitle,
} from './conventional.js';
import { sensitiveBumps } from './sensitive-bump.js';
import { substantiveWorkflowChanges } from './workflow-change.js';

export const TITLE_CHECK = 'title';

const FUNCTIONAL = FUNCTIONAL_TYPES.map((type) => `\`${type}\``).join('/');

function block(message: string): Finding {
  return { check: TITLE_CHECK, message, effect: 'block' };
}

/** Every title rule violated by this PR's current title, labels, and diff. */
export function decideTitle(pr: PullRequestFacts): CheckResult {
  const labels = new Set(pr.labels.map((label) => label.toLowerCase()));
  if (labels.has(RELEASE_PLEASE_PENDING_LABEL) || isReleasePleaseTitle(pr.title)) {
    return { findings: [] };
  }

  const title = parseTitle(pr.title);
  if (title === null) {
    return {
      findings: [
        block(
          `\`${pr.title}\` is not a Conventional Commit. Expected \`<type>[(<scope>)][!]: <subject>\` with a type of ${COMMIT_TYPES.join(', ')}. Edit the title; it becomes the squash commit on \`main\`.`,
        ),
      ],
    };
  }

  const findings: Finding[] = [];
  const functional = isFunctionalType(title.type);
  const breakingLabel = labels.has(BREAKING_CHANGE_LABEL);
  const breakingIntent = breakingLabel || labels.has(HOTFIX_LABEL);

  if (!functional) {
    if (title.breaking) {
      findings.push(
        block(
          `\`!\` is only allowed on ${FUNCTIONAL}; on \`${title.type}\` it would cut a spurious major release. Drop the \`!\`.`,
        ),
      );
    }
    if (breakingLabel) {
      findings.push(
        block(
          `\`${BREAKING_CHANGE_LABEL}\` is only meaningful on ${FUNCTIONAL}. Remove the label, or retitle to the functional type if this really is a breaking code change. (A CI change doesn't need it: sibling rebases key off the changed paths.)`,
        ),
      );
    }
  } else if (breakingIntent && !title.breaking) {
    findings.push(
      block(
        `The PR is labelled breaking but the title has no \`!\`, so the release would miss the major. Retitle to \`${title.type}${title.scope ? `(${title.scope})` : ''}!: ${title.subject}\`.`,
      ),
    );
  } else if (!breakingIntent && title.breaking) {
    findings.push(
      block(
        `The title marks a breaking change but the PR lacks the \`${BREAKING_CHANGE_LABEL}\` label, which is the source of truth. Add the label, or drop the \`!\`.`,
      ),
    );
  }

  // A release type is never told to become `ci`: that would suppress the
  // release. Sibling rebases for a CI change key off its paths, not its type,
  // so on the remaining types `ci` is only a recommendation.
  const mayRetitle = !functional && title.type !== 'ci';

  const workflows = substantiveWorkflowChanges(pr.workflowChanges);
  if (workflows.length > 0 && mayRetitle) {
    findings.push({
      check: TITLE_CHECK,
      effect: 'info',
      message: `This PR changes this repo's own CI (${workflows.map((path) => `\`${path}\``).join(', ')}); consider titling it \`ci(<scope>): …\`.`,
    });
  }

  const bumps = sensitiveBumps(pr.manifestChanges);
  if (bumps.length > 0 && mayRetitle) {
    findings.push(
      block(
        `This PR changes the version of ${bumps.map((name) => `\`${name}\``).join(', ')}, which can change lint/format results on every in-flight PR. Retitle to \`ci(deps): …\` so siblings re-test; do not use \`!\` or \`${BREAKING_CHANGE_LABEL}\` for it.`,
      ),
    );
  }

  return { findings };
}

export const titleCheck: PolicyCheck = {
  name: TITLE_CHECK,
  evaluate: async (pr: PullRequestFacts) => decideTitle(pr),
};
