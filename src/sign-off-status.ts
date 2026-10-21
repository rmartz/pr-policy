/**
 * pr-lifecycle's sign-off status: the one signal pr-lifecycle sends this gate.
 * pr-lifecycle classifies each head and posts a `pr-lifecycle/sign-off` commit
 * status on it whose description says which human sign-off the head needs, for
 * example `v1 requirement=uat waiver=current`. The format is pr-lifecycle's
 * contract (its docs/sign-off-status.md, rmartz/pr-lifecycle#119); the two
 * must stay compatible.
 *
 * GitHub ties a status to its SHA, so a push can never leave the gate reading a
 * classification of an older head. The gate never reads pr-lifecycle's labels.
 *
 * Everything here fails closed: an unknown version, an unknown key or value, a
 * status that isn't `success`, or a creator who couldn't sign off a PR is
 * `rejected`, and the checks hold. Only a missing status is `absent`, which
 * keeps the checks on their own classification until the repo cuts over.
 */
import { SIGN_OFF_STATUS_CONTEXT } from './contract.js';
import type { CommitStatus, PullRequestFacts } from './policy.js';
import { vet } from './sign-off.js';

export { SIGN_OFF_STATUS_CONTEXT };

/** The description format versions this gate understands. */
export const SIGN_OFF_STATUS_VERSIONS = ['v1'] as const;

export const SIGN_OFF_REQUIREMENTS = ['none', 'ci', 'uat'] as const;
export type SignOffRequirement = (typeof SIGN_OFF_REQUIREMENTS)[number];

export const WAIVER_STATES = ['current', 'stale', 'absent'] as const;
export type WaiverState = (typeof WAIVER_STATES)[number];

/** A parsed, valid sign-off status. */
export type SignOffClassification =
  | { requirement: 'none'; loosening: boolean }
  | { requirement: 'ci'; loosening: boolean }
  | { requirement: 'uat'; loosening: boolean; waiver: WaiverState };

export type SignOffStatusReading =
  | { kind: 'absent' }
  | { kind: 'rejected'; reason: string }
  | { kind: 'valid'; classification: SignOffClassification; postedBy: string };

const KNOWN_KEYS = new Set(['requirement', 'waiver', 'loosening']);

const member = <T extends string>(values: readonly T[], value: string | undefined): T | undefined =>
  values.find((candidate) => candidate === value);

/**
 * Parse a status description, or say why it can't be trusted. Strict on
 * purpose: a key this gate doesn't know could change what the status means, so
 * pr-lifecycle bumps the version for any new key.
 */
export function parseSignOffDescription(description: string): SignOffClassification | string {
  const [version, ...pairs] = description.trim().split(/\s+/);
  if (member(SIGN_OFF_STATUS_VERSIONS, version) === undefined) {
    return `its format version \`${version ?? ''}\` is not one this pr-policy understands (${SIGN_OFF_STATUS_VERSIONS.join(', ')})`;
  }
  const fields = new Map<string, string>();
  for (const pair of pairs) {
    const [key = '', value, ...rest] = pair.split('=');
    if (value === undefined || rest.length > 0) return `\`${pair}\` is not a \`key=value\` pair`;
    if (!KNOWN_KEYS.has(key)) return `\`${key}\` is not a known key`;
    if (fields.has(key)) return `\`${key}\` appears twice`;
    fields.set(key, value);
  }

  const requirement = member(SIGN_OFF_REQUIREMENTS, fields.get('requirement'));
  if (requirement === undefined) return '`requirement` must be `none`, `ci`, or `uat`';
  const looseningText = fields.get('loosening') ?? 'no';
  if (looseningText !== 'yes' && looseningText !== 'no') return '`loosening` must be `yes` or `no`';
  const loosening = looseningText === 'yes';

  if (requirement !== 'uat') {
    if (fields.has('waiver')) return '`waiver` is only meaningful with `requirement=uat`';
    return { requirement, loosening };
  }
  const waiver = member(WAIVER_STATES, fields.get('waiver'));
  if (waiver === undefined) return '`requirement=uat` needs `waiver=current`, `stale`, or `absent`';
  return { requirement, loosening, waiver };
}

/**
 * The Bot any workflow in a repo can post as with its `GITHUB_TOKEN`. It can
 * never be trusted to post the status, so a caller can't name it.
 */
export const GITHUB_ACTIONS_BOT = 'github-actions[bot]';

/** The caller option that names trusted status creators, as the finding names it. */
const CREATORS_OPTION = '`sign-off-status-creators` (CLI `--sign-off-status-creators`)';

/**
 * Validate a caller's list of GitHub App logins trusted to post the status
 * (rmartz/pr-policy#97). Each entry is an exact login ending in `[bot]`, such
 * as `rmartz-merge-bot[bot]`; blanks are dropped. `github-actions[bot]` is
 * refused in any case, because any workflow can post as it. Throws on a bad
 * entry, so a misconfigured caller fails loudly rather than trusting less or
 * more than it meant to.
 */
export function parseSignOffStatusCreators(entries: readonly string[]): string[] {
  const logins = entries.map((entry) => entry.trim()).filter((entry) => entry !== '');
  for (const login of logins) {
    if (login.toLowerCase() === GITHUB_ACTIONS_BOT) {
      throw new Error(
        `${GITHUB_ACTIONS_BOT} can't be a sign-off status creator: any workflow in the repo can post as it.`,
      );
    }
    if (!login.endsWith('[bot]')) {
      throw new Error(
        `\`${login}\` isn't a GitHub App login: sign-off status creators end in \`[bot]\`. People are trusted by their repo permission, without being named.`,
      );
    }
  }
  return [...new Set(logins)];
}

/** Why a status's creator can't be trusted, or `undefined` when they can. */
function untrustedCreator(
  creator: NonNullable<CommitStatus['creator']>,
  trustedBots: readonly string[],
): string | undefined {
  if (creator.type === 'Bot') {
    // Exact, case-sensitive match: a caller names the identity it means.
    if (trustedBots.includes(creator.login)) return undefined;
    if (creator.login.toLowerCase() === GITHUB_ACTIONS_BOT) {
      return `it was posted by \`${creator.login}\`, which any workflow in the repo can post as`;
    }
    return `it was posted by \`${creator.login}\`, a GitHub App this caller doesn't trust. If it is the repo's pr-lifecycle App, name it in ${CREATORS_OPTION}`;
  }
  const vetted = vet(creator);
  return typeof vetted === 'string' ? vetted : undefined;
}

/** Why a posted status can't be trusted, or `undefined` when it can. */
function untrustedReason(status: CommitStatus, trustedBots: readonly string[]): string | undefined {
  if (status.state !== 'success') return `its state is \`${status.state}\`, not \`success\``;
  if (status.creator === undefined) return 'GitHub names no account that posted it';
  return untrustedCreator(status.creator, trustedBots);
}

/**
 * Read pr-lifecycle's sign-off status on the head, judging its creator and
 * format. The creator must be a `User` who could merge, or a Bot named in
 * `trustedBots` (validated by `parseSignOffStatusCreators`).
 */
export function readSignOffStatus(
  pr: Pick<PullRequestFacts, 'signOffStatus'>,
  trustedBots: readonly string[] = [],
): SignOffStatusReading {
  const status = pr.signOffStatus;
  if (status === undefined) return { kind: 'absent' };
  const untrusted = untrustedReason(status, trustedBots);
  if (untrusted !== undefined) return { kind: 'rejected', reason: untrusted };
  const parsed = parseSignOffDescription(status.description);
  if (typeof parsed === 'string') return { kind: 'rejected', reason: parsed };
  return { kind: 'valid', classification: parsed, postedBy: status.creator?.login ?? '' };
}

/** A finding message for a status the gate won't use. */
export function rejectedStatusMessage(reason: string): string {
  return `Waiting on pr-lifecycle: its \`${SIGN_OFF_STATUS_CONTEXT}\` status on this head can't be used, because ${reason}. pr-lifecycle posts a fresh one on its next run.`;
}
