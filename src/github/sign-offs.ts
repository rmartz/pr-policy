/**
 * Who applied each sign-off label on a PR. A label records nobody, so this reads
 * the PR's `labeled` events and takes the actor of the latest one per label
 * (re-applying a label replaces who applied it), then looks up that user's
 * repository role. Nothing is read unless a sign-off label is present. The trust
 * judgment itself is pure, in src/sign-off.ts.
 */
import { SIGN_OFF_LABELS } from '../contract.js';
import { ghCall } from '../lib/github.js';
import { REPO_PERMISSIONS } from '../policy.js';
import type { RepoPermission, SignOff } from '../policy.js';
import type { PullRequestTarget } from './pull-request.js';

interface LabelEvent {
  label: string;
  login: string | null;
  type: string | null;
}

async function listLabelEvents(target: PullRequestTarget): Promise<LabelEvent[]> {
  const out = await ghCall(
    {
      argv: [
        'gh',
        'api',
        '--paginate',
        `repos/${target.repo}/issues/${target.pr}/events`,
        '--jq',
        '.[] | select(.event == "labeled") | {label: .label.name, login: .actor.login, type: .actor.type}',
      ],
    },
    null,
    { cwd: target.cwd },
  );
  // Throw rather than return no events: that would hold the gate with a
  // misleading "nobody applied it" reason instead of surfacing the failure.
  if (out === null) throw new Error(`could not list label events of ${target.repo}#${target.pr}`);
  return out
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as LabelEvent);
}

function isPermission(value: string): value is RepoPermission {
  return REPO_PERMISSIONS.some((permission) => permission === value);
}

/**
 * A user's role, preferring the fine-grained name (which tells maintain and
 * triage apart) over the legacy level. A non-collaborator's 404, or any failed
 * lookup, is `none`: an unknown actor never passes a gate.
 */
async function lookupPermission(target: PullRequestTarget, login: string): Promise<RepoPermission> {
  const out = await ghCall(
    {
      argv: [
        'gh',
        'api',
        `repos/${target.repo}/collaborators/${encodeURIComponent(login)}/permission`,
        '--jq',
        '{permission, role_name}',
      ],
    },
    null,
    { cwd: target.cwd },
  );
  if (out === null) return 'none';
  const { permission, role_name: roleName } = JSON.parse(out) as {
    permission?: string;
    role_name?: string;
  };
  if (roleName !== undefined && isPermission(roleName)) return roleName;
  return permission !== undefined && isPermission(permission) ? permission : 'none';
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
      if (event === undefined || event.login === null) return { label };
      const type = event.type ?? 'unknown actor';
      // Only a person can sign off, so a bot skips the permission lookup.
      const permission = type === 'User' ? await lookupPermission(target, event.login) : 'none';
      return { label, appliedBy: { login: event.login, type, permission } };
    }),
  );
}
