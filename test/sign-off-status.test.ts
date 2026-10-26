import { describe, expect, it } from 'vitest';
import {
  parseSignOffDescription,
  parseSignOffStatusCreators,
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
    ['an unknown version', 'v9 requirement=none', 'format version `v9`'],
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
    ['v2 `signoff` in v1', 'v1 requirement=uat signoff=passed', '`signoff` is not a known key'],
  ])('rejects %s', (_case, description, reason) => {
    expect(parseSignOffDescription(description)).toEqual(expect.stringContaining(reason));
  });
});

describe('parseSignOffDescription — the v2 format', () => {
  it.each([
    ['v2 requirement=none', { requirement: 'none', loosening: false }],
    ['v2 requirement=ci loosening=yes', { requirement: 'ci', loosening: true }],
    [
      'v2 requirement=uat signoff=waived',
      { requirement: 'uat', loosening: false, signoff: 'waived' },
    ],
    [
      'v2 requirement=uat signoff=passed loosening=yes',
      { requirement: 'uat', loosening: true, signoff: 'passed' },
    ],
    [
      'v2 signoff=absent requirement=uat',
      { requirement: 'uat', loosening: false, signoff: 'absent' },
    ],
  ])('parses %j', (description, expected) => {
    expect(parseSignOffDescription(description)).toEqual(expected);
  });

  it.each([
    ['`signoff` off uat', 'v2 requirement=none signoff=passed', 'only meaningful with'],
    ['`signoff` with a ci requirement', 'v2 requirement=ci signoff=waived', 'only meaningful with'],
    ['uat with no signoff', 'v2 requirement=uat', 'needs `signoff='],
    ['an unknown signoff', 'v2 requirement=uat signoff=current', 'needs `signoff='],
    ['v1 `waiver` in v2', 'v2 requirement=uat waiver=current', '`waiver` is not a known key'],
    [
      'both sign-off keys',
      'v2 requirement=uat signoff=passed waiver=current',
      '`waiver` is not a known key',
    ],
    ['a repeated signoff', 'v2 requirement=uat signoff=passed signoff=waived', 'appears twice'],
    ['an unknown key', 'v2 requirement=none colour=blue', '`colour` is not a known key'],
    ['a bad loosening', 'v2 requirement=ci loosening=true', '`loosening` must be'],
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
      'any workflow in the repo can post as',
    ],
    [
      'a triage-only user',
      { creator: { login: 'helper', type: 'User', permission: 'triage' as const } },
      '`triage` permission',
    ],
    ['no traceable creator', { creator: undefined }, 'names no account'],
  ])('ignores %s, so the checks fall back, and says why', (_case, overrides, reason) => {
    const reading = readSignOffStatus({ signOffStatus: status('v1 requirement=none', overrides) });
    expect(reading.kind).toBe('ignored');
    expect(reading.kind === 'ignored' && reading.reason).toContain(reason);
  });

  it.each([
    ['a pending status', { state: 'pending' }, 'state is `pending`'],
    ['an error status', { state: 'error' }, 'state is `error`'],
  ])('rejects %s from a trusted creator', (_case, overrides, reason) => {
    const reading = readSignOffStatus({ signOffStatus: status('v1 requirement=none', overrides) });
    expect(reading.kind).toBe('rejected');
    expect(reading.kind === 'rejected' && reading.reason).toContain(reason);
  });

  it('ignores an untrusted creator before looking at its state or format', () => {
    const forged = status('garbage', {
      state: 'error',
      creator: { login: 'github-actions[bot]', type: 'Bot', permission: 'none' },
    });
    expect(readSignOffStatus({ signOffStatus: forged }).kind).toBe('ignored');
  });

  it('rejects a trusted creator whose format it does not know', () => {
    const reading = readSignOffStatus({ signOffStatus: status('v9 requirement=none') });
    expect(reading.kind).toBe('rejected');
  });
});

const APP: LabelActor = { login: 'rmartz-merge-bot[bot]', type: 'Bot', permission: 'none' };
const MERGE_BOT = ['rmartz-merge-bot[bot]'];

describe('readSignOffStatus — caller-named GitHub Apps', () => {
  it('accepts a status from an App the caller names', () => {
    const reading = readSignOffStatus(
      { signOffStatus: status('v1 requirement=none', { creator: APP }) },
      MERGE_BOT,
    );
    expect(reading).toEqual({
      kind: 'valid',
      classification: { requirement: 'none', loosening: false },
      postedBy: 'rmartz-merge-bot[bot]',
    });
  });

  it('ignores a status from an App the caller does not name, and says how to trust it', () => {
    const other: LabelActor = { login: 'some-app[bot]', type: 'Bot', permission: 'none' };
    const reading = readSignOffStatus(
      { signOffStatus: status('v1 requirement=none', { creator: other }) },
      MERGE_BOT,
    );
    expect(reading.kind).toBe('ignored');
    const reason = reading.kind === 'ignored' ? reading.reason : '';
    expect(reason).toContain('`some-app[bot]`');
    expect(reason).toContain('sign-off-status-creators');
  });

  it('ignores an App status by default, when the caller names none', () => {
    expect(
      readSignOffStatus({ signOffStatus: status('v1 requirement=none', { creator: APP }) }).kind,
    ).toBe('ignored');
  });

  it('matches exactly: a differently cased login is not the named App', () => {
    const cased: LabelActor = { ...APP, login: 'RMartz-Merge-Bot[bot]' };
    expect(
      readSignOffStatus(
        { signOffStatus: status('v1 requirement=none', { creator: cased }) },
        MERGE_BOT,
      ).kind,
    ).toBe('ignored');
  });

  it('only trusts a named login when GitHub reports it as a Bot', () => {
    const impostor: LabelActor = {
      login: 'rmartz-merge-bot[bot]',
      type: 'User',
      permission: 'read',
    };
    expect(
      readSignOffStatus(
        { signOffStatus: status('v1 requirement=none', { creator: impostor }) },
        MERGE_BOT,
      ).kind,
    ).toBe('ignored');
  });

  it('still ignores a User without write, whatever Apps are named', () => {
    const reader: LabelActor = { login: 'fan', type: 'User', permission: 'read' };
    expect(
      readSignOffStatus(
        { signOffStatus: status('v1 requirement=none', { creator: reader }) },
        MERGE_BOT,
      ).kind,
    ).toBe('ignored');
  });

  it('still needs a valid description from a named App', () => {
    const reading = readSignOffStatus(
      { signOffStatus: status('v9 requirement=none', { creator: APP }) },
      MERGE_BOT,
    );
    expect(reading.kind).toBe('rejected');
  });
});

describe('parseSignOffStatusCreators', () => {
  it('keeps exact App logins and drops blanks and repeats', () => {
    expect(
      parseSignOffStatusCreators([
        'rmartz-merge-bot[bot]',
        ' ',
        'lifecycle[bot] ',
        'rmartz-merge-bot[bot]',
      ]),
    ).toEqual(['rmartz-merge-bot[bot]', 'lifecycle[bot]']);
  });

  it('is empty by default', () => {
    expect(parseSignOffStatusCreators([''])).toEqual([]);
  });

  it.each(['github-actions[bot]', 'GitHub-Actions[bot]'])(
    'refuses %s, which any workflow can post as',
    (login) => {
      expect(() => parseSignOffStatusCreators([login])).toThrow(
        'any workflow in the repo can post as it',
      );
    },
  );

  it('refuses a login that is not a GitHub App', () => {
    expect(() => parseSignOffStatusCreators(['reed'])).toThrow("isn't a GitHub App login");
  });
});
