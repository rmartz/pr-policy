/**
 * Whether a sign-off label counts. A label records nobody, so trust comes from
 * the actor on its latest `labeled` event: it counts only when a `User` with
 * write, maintain, or admin permission applied it, someone who could merge the
 * PR anyway. That rejects GitHub Apps, bots, and triage-only users. Agents act
 * with the user's token, so they pass. See docs/decisions.md.
 */
import type { LabelActor, PullRequestFacts, RepoPermission } from './policy.js';

const MERGE_PERMISSIONS: ReadonlySet<RepoPermission> = new Set(['admin', 'maintain', 'write']);

export type SignOffState =
  | { status: 'absent' }
  | { status: 'trusted'; label: string; appliedBy: LabelActor }
  | { status: 'untrusted'; label: string; reason: string };

/** The actor when they can sign off, otherwise why they can't. */
function vet(actor: LabelActor | undefined): LabelActor | string {
  if (actor === undefined) return 'no labeling event names a live account';
  if (actor.type !== 'User') return `\`${actor.login}\` is a ${actor.type}, not a person`;
  if (!MERGE_PERMISSIONS.has(actor.permission)) {
    return `\`${actor.login}\` has \`${actor.permission}\` permission; write, maintain, or admin is required`;
  }
  return actor;
}

/**
 * The state of a sign-off expressed by any of `names`. The first trusted one
 * wins; otherwise the first present-but-untrusted one explains why it doesn't
 * count.
 */
export function signOffState(
  pr: Pick<PullRequestFacts, 'labels' | 'signOffs'>,
  names: readonly string[],
): SignOffState {
  const present = names.filter((name) => pr.labels.includes(name));
  let untrusted: SignOffState | undefined;
  for (const label of present) {
    const vetted = vet(pr.signOffs.find((signOff) => signOff.label === label)?.appliedBy);
    if (typeof vetted !== 'string') return { status: 'trusted', label, appliedBy: vetted };
    untrusted ??= { status: 'untrusted', label, reason: vetted };
  }
  return untrusted ?? { status: 'absent' };
}
