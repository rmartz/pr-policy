/**
 * What a Dependabot PR changed in a dependency manifest, compared structurally:
 * both sides are parsed, and the changed dependency entries are diffed as data,
 * never as diff text. Everything outside the dependency entries must be
 * unchanged, because Dependabot never edits it.
 */
import { asRecord, deepEqual } from '../ci-change/structure.js';
import {
  DEPENDENCY_FIELDS,
  REQUIREMENT_LINE,
  normalize,
  pipVersions,
} from '../title/sensitive-bump.js';
import type { FileChange } from '../../policy.js';

/** One dependency entry whose spec differs. An absent side was added or removed. */
export interface DependencyEdit {
  name: string;
  before?: string;
  after?: string;
}

/** A manifest's dependency edits, plus the non-dependency parts that changed. */
export interface ManifestDiff {
  edits: DependencyEdit[];
  otherChanges: string[];
}

interface Entry {
  name: string;
  spec: string;
}

/** `foo@^1`, `a>foo`, and `@scope/foo@2` all name `foo` / `@scope/foo`. */
function packageName(key: string): string {
  const leaf = key.slice(key.lastIndexOf('>') + 1);
  const at = leaf.indexOf('@', 1);
  return at === -1 ? leaf : leaf.slice(0, at);
}

/**
 * Collect a dependency block's string entries, keyed by where they sit. npm
 * `overrides` nest, and a nested `.` key pins the parent package itself.
 */
function collect(where: string, block: unknown, into: Map<string, Entry>): void {
  const record = asRecord(block);
  if (record === undefined) return;
  const parent = where.slice(where.lastIndexOf(' ') + 1);
  for (const [key, value] of Object.entries(record)) {
    const at = `${where} ${key}`;
    if (typeof value === 'string') {
      into.set(at, { name: packageName(key === '.' ? parent : key), spec: value });
    } else {
      collect(at, value, into);
    }
  }
}

/** Parse a `package.json` into its dependency entries and everything else. */
function splitNpm(
  text: string,
): { entries: Map<string, Entry>; rest: Record<string, unknown> } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const doc = asRecord(parsed);
  if (doc === undefined) return null;
  const entries = new Map<string, Entry>();
  const rest = { ...doc };
  for (const field of [...DEPENDENCY_FIELDS, 'overrides', 'resolutions']) {
    collect(field, doc[field], entries);
    delete rest[field];
  }
  const pnpm = asRecord(doc['pnpm']);
  if (pnpm !== undefined) {
    collect('pnpm.overrides', pnpm['overrides'], entries);
    const { overrides: _overrides, ...pnpmRest } = pnpm;
    rest['pnpm'] = pnpmRest;
  }
  const manager = doc['packageManager'];
  if (typeof manager === 'string') {
    // `pnpm@10.1.0+sha512.…`: the name, then the version before any hash.
    const at = manager.indexOf('@', 1);
    const name = at === -1 ? manager : manager.slice(0, at);
    const spec = at === -1 ? '' : manager.slice(at + 1).replace(/\+.*/, '');
    entries.set('packageManager', { name, spec });
    delete rest['packageManager'];
  }
  return { entries, rest };
}

function diffEntries(before: Map<string, Entry>, after: Map<string, Entry>): DependencyEdit[] {
  const edits: DependencyEdit[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(key);
    const now = after.get(key);
    if (was?.spec === now?.spec && was?.name === now?.name) continue;
    edits.push({ name: (now ?? was)?.name ?? key, before: was?.spec, after: now?.spec });
  }
  return edits;
}

function diffNpm(baseText: string, headText: string): ManifestDiff | null {
  const before = splitNpm(baseText);
  const after = splitNpm(headText);
  if (before === null || after === null) return null;
  const otherChanges = [...new Set([...Object.keys(before.rest), ...Object.keys(after.rest)])]
    .filter((key) => !deepEqual(before.rest[key], after.rest[key]))
    .map((key) => `\`${key}\``);
  return { edits: diffEntries(before.entries, after.entries), otherChanges };
}

/** Lines that aren't a pinned requirement: comments, includes (`-r`), options. */
function otherLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !REQUIREMENT_LINE.test(line.replace(/#.*/, '')));
}

function diffPip(baseText: string, headText: string): ManifestDiff {
  const toEntries = (text: string) =>
    new Map([...pipVersions(text)].map(([name, spec]) => [name, { name, spec }]));
  const edits = diffEntries(toEntries(baseText), toEntries(headText));
  const otherChanges = deepEqual(otherLines(baseText), otherLines(headText))
    ? []
    : ['lines other than pinned requirements'];
  return { edits, otherChanges };
}

/**
 * The dependency edits and other changes in one manifest, or `null` when a side
 * won't parse. The caller has already rejected an added or deleted manifest.
 */
export function diffManifest(change: Required<FileChange>): ManifestDiff | null {
  return change.path.endsWith('package.json')
    ? diffNpm(change.baseText, change.headText)
    : diffPip(change.baseText, change.headText);
}

/** How a manifest names a package for claim lookup: pip names are normalized. */
export function manifestKey(path: string, name: string): string {
  return path.endsWith('package.json') ? name : normalize(name);
}

/** Whether a version spec (`^3.9.9`, `==3.9.9`, `3.9.9`) pins exactly `version`. */
export function specMentions(spec: string, version: string): boolean {
  const escaped = version.replace(/^v/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\w.])v?${escaped}(?:$|[^\\w.-])`).test(spec);
}
