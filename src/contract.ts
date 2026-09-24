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
 * (rmartz/dotfiles#1572) finishes. `no UAT needed` is a waiver from the review
 * agent or a person.
 */
export const UAT_PASSED_LABEL = 'UAT passed';
export const LEGACY_UAT_PASSED_LABEL = 'tested';
export const NO_UAT_NEEDED_LABEL = 'no UAT needed';

/**
 * Every label that counts only when a trusted person applied it. The facts
 * gatherer looks up who applied each one present on the PR.
 */
export const SIGN_OFF_LABELS = [
  CI_CHANGE_APPROVED_LABEL,
  UAT_PASSED_LABEL,
  LEGACY_UAT_PASSED_LABEL,
  NO_UAT_NEEDED_LABEL,
] as const;

/**
 * Labels the title check reads and never writes. They belong to the review and
 * release flow: `breaking change` is the source of truth for a breaking PR,
 * `hotfix` implies one, and release-please marks its release PRs with
 * `autorelease: pending`.
 */
export const BREAKING_CHANGE_LABEL = 'breaking change';
export const HOTFIX_LABEL = 'hotfix';
export const RELEASE_PLEASE_PENDING_LABEL = 'autorelease: pending';
