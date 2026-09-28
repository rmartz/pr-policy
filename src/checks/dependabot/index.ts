/**
 * Check 4: a Dependabot PR changes only the updates it claims. bot-automerge
 * merges these PRs without a human review, on the premise that the PR is what
 * the bot says it is. This check enforces that premise: it reads the claim from
 * the description and blocks on any change the claim doesn't cover — a stray
 * path, an unclaimed dependency, a version other than the claimed one, or an
 * edit Dependabot never makes. A mismatch means someone else pushed to the
 * branch or edited the body; recreating the PR clears it.
 *
 * Applies only to PRs opened by `dependabot[bot]`. See docs/checks/dependabot.md.
 */
import type {
  CheckResult,
  FileChange,
  Finding,
  PolicyCheck,
  PullRequestFacts,
} from '../../policy.js';
import { diffWorkflow } from './actions.js';
import { parseClaims, titlePackage, type Claim } from './claims.js';
import { diffManifest, manifestKey, specMentions } from './manifests.js';
import { dependencyPathKind } from './paths.js';

export const DEPENDABOT_CHECK = 'dependabot';
export const DEPENDABOT_LOGIN = 'dependabot[bot]';

const RECREATE = 'Drop the change, or comment `@dependabot recreate` to rebuild the PR.';

function block(message: string): Finding {
  return { check: DEPENDABOT_CHECK, message: `${message} ${RECREATE}`, effect: 'block' };
}

function info(message: string): Finding {
  return { check: DEPENDABOT_CHECK, message, effect: 'info' };
}

/** Claims keyed the way `key` normalizes names, so lookups match manifest names. */
function indexClaims(claims: readonly Claim[], key: (name: string) => string): Map<string, Claim> {
  return new Map(claims.map((claim) => [key(claim.name), claim]));
}

function isComplete(change: FileChange): change is Required<FileChange> {
  return change.baseText !== undefined && change.headText !== undefined;
}

function manifestProblems(change: FileChange, claims: readonly Claim[]): string[] {
  if (!isComplete(change)) {
    return [`\`${change.path}\` was added or deleted; Dependabot only edits existing manifests.`];
  }
  const diff = diffManifest(change);
  if (diff === null) return [`\`${change.path}\` doesn't parse, so its changes can't be verified.`];
  const claimed = indexClaims(claims, (name) => manifestKey(change.path, name));
  const problems = diff.otherChanges.map(
    (field) => `\`${change.path}\` changes ${field}, which Dependabot never edits.`,
  );
  for (const edit of diff.edits) {
    const claim = claimed.get(manifestKey(change.path, edit.name));
    const specs = `\`${edit.before ?? '(none)'}\` → \`${edit.after ?? '(none)'}\``;
    if (claim === undefined) {
      problems.push(
        `\`${change.path}\` changes \`${edit.name}\` (${specs}), which the description doesn't claim.`,
      );
    } else if (
      claim.to !== undefined &&
      edit.after !== undefined &&
      !specMentions(edit.after, claim.to)
    ) {
      problems.push(
        `\`${change.path}\` sets \`${edit.name}\` to \`${edit.after}\`, but the description claims ${claim.to}.`,
      );
    }
  }
  return problems;
}

function workflowProblems(change: FileChange, claims: readonly Claim[]): string[] {
  if (!isComplete(change)) {
    return [`\`${change.path}\` was added or deleted; Dependabot only edits existing workflows.`];
  }
  const diff = diffWorkflow(change);
  if (diff.kind === 'unparseable') {
    return [`\`${change.path}\` doesn't parse, so its changes can't be verified.`];
  }
  if (diff.kind === 'structural') {
    return [
      `\`${change.path}\` changes more than action refs; Dependabot only moves \`uses:\` pins.`,
    ];
  }
  // GitHub owner and repo names are case-insensitive.
  const claimed = indexClaims(claims, (name) => name.toLowerCase());
  return diff.actions
    .filter((action) => !claimed.has(action.toLowerCase()))
    .map(
      (action) => `\`${change.path}\` moves \`${action}\`, which the description doesn't claim.`,
    );
}

/** Every way this Dependabot PR's content departs from its claimed updates. */
export function decideDependabot(pr: PullRequestFacts): CheckResult {
  if (pr.author?.login !== DEPENDABOT_LOGIN) return { findings: [] };

  const claims = parseClaims(pr.body ?? '');
  if (claims.length === 0) {
    return {
      findings: [
        block(
          "The description names no update (`Bumps …` / ``Updates `…` from … to …``), so the PR's content can't be checked against it. It was edited or truncated.",
        ),
      ],
    };
  }

  const problems: string[] = [];
  const named = titlePackage(pr.title);
  const sameName = (claim: Claim) => claim.name.toLowerCase() === named?.toLowerCase();
  if (named !== undefined && !claims.some(sameName)) {
    problems.push(`The title bumps \`${named}\`, but the description doesn't claim it.`);
  }

  const unverified: string[] = [];
  for (const path of new Set(pr.changedFiles)) {
    const kind = dependencyPathKind(path);
    if (kind === undefined) {
      problems.push(`\`${path}\` isn't a dependency file; Dependabot never edits it.`);
    } else if (kind === 'lockfile' || kind === 'other-ecosystem') {
      unverified.push(`\`${path}\``);
    }
  }
  for (const change of pr.manifestChanges) problems.push(...manifestProblems(change, claims));
  for (const change of pr.workflowChanges) problems.push(...workflowProblems(change, claims));

  const findings = problems.map(block);
  if (unverified.length > 0) {
    findings.push(info(`Allowed but not content-verified: ${unverified.join(', ')}.`));
  }
  if (problems.length === 0) {
    const count = `${claims.length} claimed update${claims.length === 1 ? '' : 's'}`;
    findings.unshift({ ...info(`Dependabot PR matches its ${count}`), headline: true });
  }
  return { findings };
}

export const dependabotCheck: PolicyCheck = {
  name: DEPENDABOT_CHECK,
  evaluate: async (pr: PullRequestFacts) => decideDependabot(pr),
};
