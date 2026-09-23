import { describe, expect, it } from 'vitest';
import {
  CI_APPROVAL_NEEDED_LABEL,
  CI_CHANGE_APPROVED_LABEL,
  PR_POLICY_CHECK_NAME,
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
});
