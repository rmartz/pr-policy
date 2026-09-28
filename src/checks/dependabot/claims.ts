/**
 * The updates a Dependabot PR claims, read from its description. The body is
 * Dependabot's own record: a review agent may retitle the PR (`chore(deps):` →
 * `ci(deps):`), but nothing rewrites the body. Three sentence forms carry every
 * claim Dependabot makes:
 *
 * - `Bumps [name](url) from A to B.` — a single update.
 * - ``Updates `name` from A to B`` — one entry of a grouped update, or of a
 *   single PR that bumps packages together.
 * - `Updates the requirements on [name](url) to permit ...` — a range change
 *   with no single target version.
 *
 * Group headers (`Bumps the npm group with 3 updates: ...`) name no versions and
 * are not claims; the ``Updates `name` `` lines below them are.
 */

/** One claimed update. `to` is absent for a range change or a removal. */
export interface Claim {
  name: string;
  to?: string;
}

/** A package reference: a markdown link's text, a code span, or a bare name. */
const NAME = /(?:\[([^\]]+)\]\([^)]*\)|`([^`]+)`|([^\s[\]`]+))/.source;
/** A version up to (not including) a sentence-ending period. */
const VERSION = /(\S+?)\.?(?=\s|$)/.source;

const BUMP = new RegExp(String.raw`^Bumps ${NAME} from \S+ to ${VERSION}`, 'gm');
const UPDATE = new RegExp(String.raw`^Updates ${NAME} from \S+ to ${VERSION}`, 'gm');
const REQUIREMENTS = new RegExp(String.raw`^Updates the requirements on ${NAME}`, 'gm');
const REMOVAL = new RegExp(String.raw`^Removes ${NAME}`, 'gm');

/** Dependabot writes `@​scope` with a zero-width space so it isn't a mention. */
function clean(name: string): string {
  return name.replace(/​/g, '').trim();
}

function nameOf(match: RegExpExecArray): string {
  return clean(match[1] ?? match[2] ?? match[3] ?? '');
}

/**
 * Every update the description claims, once per package. A package claimed
 * twice with different targets keeps the last, which is what Dependabot's
 * per-package `Updates` line states after a summary `Bumps` line.
 */
export function parseClaims(body: string): Claim[] {
  const claims = new Map<string, Claim>();
  for (const pattern of [BUMP, UPDATE]) {
    for (const match of body.matchAll(pattern)) {
      const name = nameOf(match);
      if (name !== '' && match[4] !== undefined) claims.set(name, { name, to: match[4] });
    }
  }
  for (const pattern of [REQUIREMENTS, REMOVAL]) {
    for (const match of body.matchAll(pattern)) {
      const name = nameOf(match);
      if (name !== '' && !claims.has(name)) claims.set(name, { name });
    }
  }
  return [...claims.values()];
}

const TITLE_BUMP = /\bbump (\S+) from \S+ to \S+/i;

/**
 * The one package a single-update title names (`chore(deps): bump x from A to
 * B`), or `undefined` for a group title (`bump the npm group ...`) or any other
 * wording.
 */
export function titlePackage(title: string): string | undefined {
  const name = TITLE_BUMP.exec(title)?.[1];
  return name === undefined || name.toLowerCase() === 'the' ? undefined : name;
}
