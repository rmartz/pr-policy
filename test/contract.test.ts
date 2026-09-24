import { describe, expect, it } from 'vitest';
import {
  CI_APPROVAL_NEEDED_LABEL,
  CI_CHANGE_APPROVED_LABEL,
  LEGACY_UAT_PASSED_LABEL,
  NO_UAT_NEEDED_LABEL,
  PR_POLICY_CHECK_NAME,
  UAT_PASSED_LABEL,
} from '../src/contract.js';

// These strings are read outside this repo (rulesets, the coordinator's gate
// model, a human applying a label). A failure here means a fleet migration, not a
// test to update — see docs/check-run-contract.md.
describe('external contract names', () => {
  it('pins the check-run name', () => {
    expect(PR_POLICY_CHECK_NAME).toBe('pr-policy');
  });

  it('pins the CI merge-gate labels', () => {
    expect(CI_APPROVAL_NEEDED_LABEL).toBe('CI approval needed');
    expect(CI_CHANGE_APPROVED_LABEL).toBe('CI change approved');
  });

  it('pins the UAT sign-off labels', () => {
    expect(UAT_PASSED_LABEL).toBe('UAT passed');
    expect(LEGACY_UAT_PASSED_LABEL).toBe('tested');
    expect(NO_UAT_NEEDED_LABEL).toBe('no UAT needed');
  });
});
