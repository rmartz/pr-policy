/**
 * Names read outside this repo. Each is a fleet contract: consumers' rulesets
 * require the check-run by literal name, the coordinator's gate model parks a PR
 * on the label, and a human applies the sign-off label by hand. Renaming any of
 * them is a coordinated cross-repo migration, never a local refactor — see
 * docs/check-run-contract.md. `test/contract.test.ts` pins every value.
 */

/**
 * The one check-run this package posts. Every policy check reports into it, so
 * adding a check never adds a required-status name.
 */
export const PR_POLICY_CHECK_NAME = 'pr-policy';

/** The merge-gate label the CI-change check applies to an unsigned loosening. */
export const CI_APPROVAL_NEEDED_LABEL = 'CI approval needed';

/**
 * The human sign-off on a CI loosening. Read-only here: this package never
 * applies it.
 */
export const CI_CHANGE_APPROVED_LABEL = 'CI change approved';

/**
 * The UAT sign-offs, read and never written. `UAT passed` is a person's
 * statement that they tested the PR; `tested` is its name until the fleet rename
 * finishes. `no UAT needed` is a waiver from the review
 * agent or a person.
 */
export const UAT_PASSED_LABEL = 'UAT passed';
export const LEGACY_UAT_PASSED_LABEL = 'tested';
export const NO_UAT_NEEDED_LABEL = 'no UAT needed';

/**
 * A person's judgment that a dependency major bump doesn't reach this package's
 * consumers, such as a wrapper that absorbs its CLI's major. Read and never
 * written. It waives only the title check's dependency-major rule, so the PR can
 * release without `!`.
 */
export const NOT_BREAKING_LABEL = 'not breaking';

/**
 * Every label that counts only when a trusted person applied it. The facts
 * gatherer looks up who applied each one present on the PR.
 */
export const SIGN_OFF_LABELS = [
  CI_CHANGE_APPROVED_LABEL,
  UAT_PASSED_LABEL,
  LEGACY_UAT_PASSED_LABEL,
  NO_UAT_NEEDED_LABEL,
  NOT_BREAKING_LABEL,
] as const;

/**
 * Labels a person puts on a PR to stop it merging. The merge-block check holds
 * `pr-policy` while any of them is present, and never applies or removes one.
 * `dnm` is shorthand for `do not merge`.
 */
export const DO_NOT_MERGE_LABEL = 'do not merge';
export const DNM_LABEL = 'dnm';
export const BLOCKED_LABEL = 'blocked';
export const ESCALATION_NEEDED_LABEL = 'escalation needed';
export const BLOCKING_LABELS = [
  DO_NOT_MERGE_LABEL,
  DNM_LABEL,
  BLOCKED_LABEL,
  ESCALATION_NEEDED_LABEL,
] as const;

/**
 * Marks a PR as an epic: a long-running feature branch that other PRs may merge
 * into. The base-branch check reads it on the PR and on the PR that heads its
 * base branch, matching case-insensitively (the fleet roster spells it `Epic`),
 * and never writes it.
 */
export const EPIC_LABEL = 'epic';

/**
 * Labels the title check reads and never writes. They belong to the review and
 * release flow: `breaking change` must agree with the title's `!`, which is what
 * the release and merge-safety read; `hotfix` implies one; and release-please
 * marks its release PRs with `autorelease: pending`.
 */
export const BREAKING_CHANGE_LABEL = 'breaking change';
export const HOTFIX_LABEL = 'hotfix';
export const RELEASE_PLEASE_PENDING_LABEL = 'autorelease: pending';
