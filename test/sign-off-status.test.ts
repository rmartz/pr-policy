import { describe, expect, it } from 'vitest';
import {
  parseSignOffDescription,
  readSignOffStatus,
  SIGN_OFF_STATUS_CONTEXT,
  type CommitStatus,
} from '../src/index.js';
import type { LabelActor } from '../src/policy.js';

const LIFECYCLE: LabelActor = { login: 'reed', type: 'User', permission: 'admin' };

const status = (description: string, overrides: Partial<CommitStatus> = {}): CommitStatus => ({
  state: 'success',
  description,
  creator: LIFECYCLE,
  ...overrides,
});

describe('parseSignOffDescription — the v1 format', () => {
  it('names the context pr-lifecycle posts', () => {
    expect(SIGN_OFF_STATUS_CONTEXT).toBe('pr-lifecycle/sign-off');
  });

  it.each([
    ['v1 requirement=none', { requirement: 'none', loosening: false }],
    ['v1 requirement=ci loosening=yes', { requirement: 'ci', loosening: true }],
    [
      'v1 requirement=uat waiver=current',
      { requirement: 'uat', loosening: false, waiver: 'current' },
    ],
    [
      'v1 requirement=uat waiver=stale loosening=yes',
      { requirement: 'uat', loosening: true, waiver: 'stale' },
    ],
    ['  v1   loosening=no requirement=none ', { requirement: 'none', loosening: false }],
  ])('parses %j', (description, expected) => {
    expect(parseSignOffDescription(description)).toEqual(expected);
  });

  it.each([
    ['an unknown version', 'v2 requirement=none', 'format version `v2`'],
    ['no version', 'requirement=none', 'format version `requirement=none`'],
    ['an empty description', '', 'format version ``'],
    ['an unknown key', 'v1 requirement=none colour=blue', '`colour` is not a known key'],
    ['a bare word', 'v1 requirement=none fast', '`fast` is not a `key=value` pair'],
    ['a repeated key', 'v1 requirement=none requirement=uat', '`requirement` appears twice'],
    ['no requirement', 'v1 loosening=yes', '`requirement` must be'],
    ['an unknown requirement', 'v1 requirement=maybe', '`requirement` must be'],
    ['a bad loosening', 'v1 requirement=ci loosening=true', '`loosening` must be'],
    ['a waiver off uat', 'v1 requirement=none waiver=current', 'only meaningful with'],
    ['uat with no waiver', 'v1 requirement=uat', 'needs `waiver='],
    ['an unknown waiver', 'v1 requirement=uat waiver=fresh', 'needs `waiver='],
  ])('rejects %s', (_case, description, reason) => {
    expect(parseSignOffDescription(description)).toEqual(expect.stringContaining(reason));
  });
});

describe('readSignOffStatus — trust', () => {
  it('is absent when pr-lifecycle posted nothing, so the checks fall back', () => {
    expect(readSignOffStatus({})).toEqual({ kind: 'absent' });
  });

  it('accepts a success status from a person who could merge', () => {
    expect(readSignOffStatus({ signOffStatus: status('v1 requirement=none') })).toEqual({
      kind: 'valid',
      classification: { requirement: 'none', loosening: false },
      postedBy: 'reed',
    });
  });

  it.each([
    [
      'a forged status from github-actions[bot]',
      { creator: { login: 'github-actions[bot]', type: 'Bot', permission: 'none' as const } },
      'is a Bot, not a person',
    ],
    [
      'a triage-only user',
      { creator: { login: 'helper', type: 'User', permission: 'triage' as const } },
      '`triage` permission',
    ],
    ['no traceable creator', { creator: undefined }, 'names no account'],
    ['a pending status', { state: 'pending' }, 'state is `pending`'],
    ['an error status', { state: 'error' }, 'state is `error`'],
  ])('rejects %s', (_case, overrides, reason) => {
    const reading = readSignOffStatus({ signOffStatus: status('v1 requirement=none', overrides) });
    expect(reading.kind).toBe('rejected');
    expect(reading.kind === 'rejected' && reading.reason).toContain(reason);
  });

  it('rejects a trusted creator whose format it does not know', () => {
    const reading = readSignOffStatus({ signOffStatus: status('v9 requirement=none') });
    expect(reading.kind).toBe('rejected');
  });
});
