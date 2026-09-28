/**
 * The updates a Dependabot PR claims, read from its description. The body is
 * Dependabot's own record: a review agent may retitle the PR (`chore(deps):` →
 * `ci(deps):`), but nothing rewrites the body. Three sentence forms carry every
 * claim Dependabot makes, plus a summary table:
 *
 * - `Bumps [name](url) from A to B.` — a single update.
 * - `| [name](url) | `A` | `B` |` — a row of the table a large group opens
 *   with. Dependabot truncates a long description, cutting off the per-package
 *   lines, but the table comes first and survives.
 * - ``Updates `name` from A to B`` — one entry of a grouped update, or of a
 *   single PR that bumps packages together.
 * - `Updates the requirements on [name](url) to permit ...` — a range change
 *   with no single target version.
 *
 * A group header (`Bumps the npm group with 3 updates: [a](url) and [b](url).`)
 * names every package but no version. Its names count as claims with no target,
 * so a truncated body that lost an `Updates` line still covers that package;
 * wherever a versioned line survives, its version is the one checked.
 */

/** One claimed update. `to` is absent for a range change or a removal. */
export interface Claim {
  name: string;
  to?: string;
}

/** A package reference: a markdown link's text, a code span, or a bare name. */
const NAME = /(?:\[([^\[\]\n]+)\]\([^)]*\)|`([^`]+)`|([^\s[\]`]+))/.source;
/** A version up to (not including) a sentence-ending period. */
const VERSION = /(\S+?)\.?(?=\s|$)/.source;

const BUMP = new RegExp(String.raw`^Bumps ${NAME} from \S+ to ${VERSION}`, 'gm');
const UPDATE = new RegExp(String.raw`^Updates ${NAME} from \S+ to ${VERSION}`, 'gm');
/** Versions in a table row are always code spans, which the header row's aren't. */
const CELL = /`[^`|]+`/.source;
const TABLE_ROW = new RegExp(String.raw`^\| ${NAME} \| ${CELL} \| \x60([^\x60|]+)\x60 \|`, 'gm');
const GROUP_HEADER = /^Bumps the \S+ group\b[^:\n]*:(.*)$/gm;
const LINK = /\[([^\[\]\n]+)\]\([^)]*\)/g;
const REQUIREMENTS = new RegExp(String.raw`^Updates the requirements on ${NAME}`, 'gm');
const REMOVAL = new RegExp(String.raw`^Removes ${NAME}`, 'gm');

/** Dependabot writes `@\u200bscope` with a zero-width space so it isn't a mention. */
function clean(name: string): string {
  return name.replace(/\u200b/g, '').trim();
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
  for (const pattern of [TABLE_ROW, BUMP, UPDATE]) {
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
  for (const header of body.matchAll(GROUP_HEADER)) {
    for (const link of (header[1] ?? '').matchAll(LINK)) {
      const name = clean(link[1] ?? '');
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
