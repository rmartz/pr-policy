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
 * Labels the title check reads and never writes. They belong to the review and
 * release flow: `breaking change` is the source of truth for a breaking PR,
 * `hotfix` implies one, and release-please marks its release PRs with
 * `autorelease: pending`.
 */
export const BREAKING_CHANGE_LABEL = 'breaking change';
export const HOTFIX_LABEL = 'hotfix';
export const RELEASE_PLEASE_PENDING_LABEL = 'autorelease: pending';
