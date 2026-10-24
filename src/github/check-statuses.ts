/**
 * One informational commit status per policy check (`pr-policy / title`), so a
 * PR's status list shows which check failed, which waits on a human and which
 * passed, without opening the check-run. Moved here from rmartz/pr-policy-action
 * so every wrapper (the Action, a hosted App) posts the same statuses.
 *
 * These are informational: the `pr-policy` verdict status is the gate, and it is
 * posted by `postVerdict` whatever happens here.
 */
import type { PolicyCheck, Finding } from '../policy.js';
import type { ClientTarget } from './client.js';
import { clientOf } from './client.js';

/** One check's status. */
export interface CheckStatus {
  check: string;
  state: 'success' | 'failure' | 'pending';
  description: string;
}

// The Statuses API rejects a description over 140 characters.
const MAX_DESCRIPTION = 140;

const STATES = { block: 'failure', hold: 'pending' } as const;

/**
 * Each check's status: red on any `block`, pending on any `hold`, else green.
 * The description leads with the finding that decided the state. A check that
 * didn't run (left out by `selectChecks`) gets no status.
 */
export function checkStatuses(
  checks: readonly Pick<PolicyCheck, 'name'>[],
  findings: readonly Finding[],
): CheckStatus[] {
  return checks.map(({ name }) => {
    const own = findings.filter((finding) => finding.check === name);
    const deciding =
      own.find((finding) => finding.effect === 'block') ??
      own.find((finding) => finding.effect === 'hold');
    const state =
      deciding?.effect === 'block' || deciding?.effect === 'hold'
        ? STATES[deciding.effect]
        : 'success';
    const lead = deciding ?? own.find((finding) => finding.headline);
    const gating = own.filter((finding) => finding.effect !== 'info').length;
    let description = lead?.message ?? 'Passed';
    if (gating > 1) description += ` (+${gating - 1} more)`;
    if (description.length > MAX_DESCRIPTION) {
      description = `${description.slice(0, MAX_DESCRIPTION - 1)}…`;
    }
    return { check: name, state, description };
  });
}

export interface CheckStatusOptions {
  /** The status names are `<context> / <check>`; default `pr-policy`. */
  context?: string;
  /** Where each status links, e.g. the Actions run. */
  targetUrl?: string;
}

/**
 * Post each check's status on `sha`. Returns false, having stopped at the first
 * failure, when one can't be posted (most often a token without
 * `statuses: write`); the caller decides whether to warn.
 */
export async function postCheckStatuses(
  target: ClientTarget & { repo: string },
  sha: string,
  statuses: readonly CheckStatus[],
  options: CheckStatusOptions = {},
): Promise<boolean> {
  const client = clientOf(target);
  const context = options.context ?? 'pr-policy';
  for (const { check, state, description } of statuses) {
    const out = await client.send('POST', `repos/${target.repo}/statuses/${sha}`, {
      state,
      context: `${context} / ${check}`,
      description,
      ...(options.targetUrl ? { target_url: options.targetUrl } : {}),
    });
    if (out === null) return false;
  }
  return true;
}
