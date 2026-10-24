/**
 * Who applied each sign-off label on a PR. A label records nobody, so this reads
 * the PR's `labeled` events and takes the actor of the latest one per label
 * (re-applying a label replaces who applied it), then looks up that user's
 * repository role. Nothing is read unless a sign-off label is present. The trust
 * judgment itself is pure, in src/sign-off.ts.
 */
import { SIGN_OFF_LABELS } from '../contract.js';
import type { RepoPermission, SignOff } from '../policy.js';
import { isRepoPermission } from '../sign-off.js';
import type { PullRequestTarget } from './pull-request.js';
import { clientOf } from './client.js';

interface LabelEvent {
  label: string;
  login: string | null;
  type: string | null;
  at: string;
}

/** The fields of an issue event this reads; `actor` is `null` for a deleted user. */
interface IssueEvent {
  event: string;
  label?: { name: string };
  actor: { login: string; type: string } | null;
  created_at: string;
}

async function listLabelEvents(target: PullRequestTarget): Promise<LabelEvent[]> {
  const out = await clientOf(target).list(`repos/${target.repo}/issues/${target.pr}/events`);
  // Throw rather than return no events: that would hold the gate with a
  // misleading "nobody applied it" reason instead of surfacing the failure.
  if (out === null) throw new Error(`could not list label events of ${target.repo}#${target.pr}`);
  return (out as IssueEvent[])
    .filter((event) => event.event === 'labeled')
    .map((event) => ({
      label: event.label?.name ?? '',
      login: event.actor?.login ?? null,
      type: event.actor?.type ?? null,
      at: event.created_at,
    }));
}

/**
 * A user's role, preferring the fine-grained name (which tells maintain and
 * triage apart) over the legacy level. A non-collaborator's 404, or any failed
 * lookup, is `none`: an unknown actor never passes a gate.
 */
export async function lookupPermission(
  target: Pick<PullRequestTarget, 'repo' | 'cwd' | 'client'>,
  login: string,
): Promise<RepoPermission> {
  const out = await clientOf(target).getJson(
    `repos/${target.repo}/collaborators/${encodeURIComponent(login)}/permission`,
  );
  if (out === null) return 'none';
  const { permission, role_name: roleName } = out as {
    permission?: string;
    role_name?: string;
  };
  if (isRepoPermission(roleName)) return roleName;
  return isRepoPermission(permission) ? permission : 'none';
}

export async function gatherSignOffs(
  target: PullRequestTarget,
  labels: readonly string[],
): Promise<SignOff[]> {
  const present = SIGN_OFF_LABELS.filter((label) => labels.includes(label));
  if (present.length === 0) return [];

  const latest = new Map<string, LabelEvent>();
  for (const event of await listLabelEvents(target)) latest.set(event.label, event);

  return Promise.all(
    present.map(async (label): Promise<SignOff> => {
      const event = latest.get(label);
      if (event === undefined) return { label };
      if (event.login === null) return { label, appliedAt: event.at };
      const type = event.type ?? 'unknown actor';
      // Only a person can sign off, so a bot skips the permission lookup.
      const permission = type === 'User' ? await lookupPermission(target, event.login) : 'none';
      return { label, appliedBy: { login: event.login, type, permission }, appliedAt: event.at };
    }),
  );
}
