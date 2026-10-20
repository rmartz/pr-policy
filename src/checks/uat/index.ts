/**
 * Check 3: UAT sign-off. A hard merge gate that **holds by default**. Whether a
 * PR needs UAT at all comes from the shared sign-off classifier
 * (src/classify-sign-off.ts): it passes when that says `none` (UAT off for the
 * repo, or statically safe) or `ci` (a CI sign-off covers it instead). A PR that
 * needs UAT passes when a trusted person applied `no UAT needed`, or `UAT
 * passed` (or its old name, `tested`) after the current head was pushed. A
 * missing label is a hold, never "not required", so a PR approved and armed for
 * auto-merge at any point still waits here.
 *
 * Read-only: this check never applies or removes a UAT label. A `UAT passed`
 * from before the head was pushed simply doesn't count. A stale `no UAT needed`
 * is pr-lifecycle's to replace. See docs/checks/uat.md.
 */
import { classifySignOff } from '../../classify-sign-off.js';
import { LEGACY_UAT_PASSED_LABEL, NO_UAT_NEEDED_LABEL, UAT_PASSED_LABEL } from '../../contract.js';
import type { CheckResult, Finding, PolicyCheck, PullRequestFacts } from '../../policy.js';
import { DEFAULT_REPO_CONFIG, type RepoConfigLoad } from '../../repo-config.js';
import { signOffState, type SignOffState } from '../../sign-off.js';

export const UAT_CHECK = 'uat';

/** Every label that passes the gate, in the order a finding reports them. */
const PASSING_LABELS = [UAT_PASSED_LABEL, LEGACY_UAT_PASSED_LABEL, NO_UAT_NEEDED_LABEL];

/**
 * Sign-offs that say a person tested this code, so they count only for the head
 * they were applied to. A new head needs a person to look again, even after a
 * clean rebase that carries an approval across.
 */
export const HEAD_BOUND_SIGN_OFFS = [UAT_PASSED_LABEL, LEGACY_UAT_PASSED_LABEL];

function info(message: string): Finding {
  return { check: UAT_CHECK, message, effect: 'info' };
}

/** Why a head-bound sign-off on the PR doesn't cover the current head, if it doesn't. */
function staleReason(
  pr: Pick<PullRequestFacts, 'signOffs' | 'headPushedAt'>,
  label: string,
): string | undefined {
  if (!HEAD_BOUND_SIGN_OFFS.includes(label)) return undefined;
  if (pr.headPushedAt === undefined) {
    return 'the time the current head was pushed is unknown, so it may predate the head';
  }
  const appliedAt = pr.signOffs.find((signOff) => signOff.label === label)?.appliedAt;
  if (appliedAt === undefined) return 'the time it was applied is unknown';
  // An unparseable time compares false, so it reads as stale.
  if (Date.parse(appliedAt) > Date.parse(pr.headPushedAt)) return undefined;
  return 'it was applied before the current head was pushed, and a new head needs a person to test it again';
}

/** The UAT sign-off on a PR: the trust state of its current labels, and the stale ones. */
export interface UatSignOff {
  /** Judged over the labels that still cover the head; stale ones are set aside. */
  state: SignOffState;
  /** Head-bound sign-offs on the PR that predate the current head, and why. */
  stale: readonly { label: string; reason: string }[];
}

/**
 * Read the UAT sign-off on a PR: who applied each label, whether they can sign
 * off, and whether a `UAT passed` still covers the current head. A stale
 * head-bound sign-off is set aside before trust is judged, so it neither passes
 * the gate nor hides a valid `no UAT needed` behind it.
 */
export function readUatSignOff(
  pr: Pick<PullRequestFacts, 'labels' | 'signOffs' | 'headPushedAt'>,
): UatSignOff {
  const stale = PASSING_LABELS.flatMap((label) => {
    const reason = pr.labels.includes(label) ? staleReason(pr, label) : undefined;
    return reason === undefined ? [] : [{ label, reason }];
  });
  const current = PASSING_LABELS.filter((label) => !stale.some((entry) => entry.label === label));
  return { state: signOffState(pr, current), stale };
}

const NO_CONFIG_PROBLEMS: RepoConfigLoad = { config: DEFAULT_REPO_CONFIG, problems: [] };

/** Decide the UAT gate for one PR, under the repo config loaded from its base. */
export function decideUat(
  pr: PullRequestFacts,
  repo: RepoConfigLoad = NO_CONFIG_PROBLEMS,
): CheckResult {
  const problems = repo.problems.map((problem) => info(`${problem}, so UAT stays on.`));
  const requirement = classifySignOff(pr, repo.config);
  switch (requirement.kind) {
    case 'none':
      return { findings: [info(requirement.reason), ...problems] };
    case 'ci':
      return {
        findings: [
          info('No UAT needed: the CI sign-off (`ci-change`) covers this PR instead.'),
          ...problems,
        ],
      };
    case 'uat':
      return { findings: [...decideUatSignOff(pr), ...problems] };
  }
}

function decideUatSignOff(pr: PullRequestFacts): Finding[] {
  const { state, stale } = readUatSignOff(pr);
  if (state.status === 'trusted') {
    return [
      {
        ...info(`UAT signed off with \`${state.label}\` by \`${state.appliedBy.login}\``),
        headline: true,
      },
    ];
  }

  const hold: Finding = {
    check: UAT_CHECK,
    message: `Waiting for UAT. A person applies \`${UAT_PASSED_LABEL}\` after testing, or the review agent or a person applies \`${NO_UAT_NEEDED_LABEL}\`.`,
    effect: 'hold',
  };
  const why = stale.map(({ label, reason }) => info(`\`${label}\` doesn't count: ${reason}.`));
  if (state.status === 'untrusted') {
    why.push(info(`\`${state.label}\` doesn't count: ${state.reason}.`));
  }
  return [hold, ...why];
}

/** The UAT check for a repo whose base-branch config is `repo`. */
export function uatCheckFor(repo: RepoConfigLoad): PolicyCheck {
  return { name: UAT_CHECK, evaluate: async (pr: PullRequestFacts) => decideUat(pr, repo) };
}

/** The UAT check under the default config (UAT on). */
export const uatCheck: PolicyCheck = uatCheckFor(NO_CONFIG_PROBLEMS);
