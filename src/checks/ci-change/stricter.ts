/**
 * Strictly-stricter edits to an existing check, told apart from other edits.
 *
 * A workflow diff can't say what a tool's flag means, so "stricter" is read
 * from a small, explicit vocabulary of bounds whose direction is known (see
 * {@link LOWER_IS_STRICTER}). Anything outside it is a change to what the check
 * enforces, and holds: a false hold costs one label, a false pass skips the
 * sign-off (docs/decisions.md).
 *
 * Three fields of an existing job or step are judged by named rules, and only
 * there: a step's `run:` command (run-rules.ts), a step's or reusable-workflow
 * job's `with:` inputs, and `timeout-minutes` (here). The containment backstop
 * ignores them for that reason (see {@link withoutJudgedFields}).
 */
import {
  ambiguousIndicator,
  looseningIndicator,
  strengtheningIndicator,
  type Indicator,
  type LooseningIndicator,
  type StrengtheningIndicator,
} from './indicators.js';
import { asRecord, commandIdentity, deepEqual, type Node } from './structure.js';

/** Bounds where a lower value rejects more: lowering one can only fail more runs. */
const LOWER_IS_STRICTER = [
  'max-warnings',
  'max-lines',
  'max-lines-per-function',
  'max-line-length',
  'max-len',
  'max-complexity',
  'max-statements',
  'max-params',
] as const;

/** Bounds where a higher value rejects more, such as a coverage floor. */
const HIGHER_IS_STRICTER = [
  'fail-under',
  'cov-fail-under',
  'min-coverage',
  'minimum-coverage',
  'coverage-threshold',
] as const;

/** Switches that only ever make a tool reject more when turned on. Matched by exact name. */
const STRICT_SWITCHES = ['strict', 'fail-on-error', 'fail-on-warning', 'fail-on-warnings'] as const;

/** GitHub's default job timeout, used when a job gains its first `timeout-minutes`. */
const DEFAULT_TIMEOUT_MINUTES = 360;

type Direction = 'lower' | 'higher';

/** `--Max_Warnings` / `maxWarnings` → `max-warnings`. */
function normalizeName(name: string): string {
  return name
    .replace(/^-+/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
}

/**
 * A bound matches by its whole name only: `--scan-max-lines` lowered scans
 * less, so a suffix of a known name proves nothing.
 */
function matchesBound(name: string, vocabulary: readonly string[]): boolean {
  return vocabulary.includes(name);
}

export function directionOf(rawName: string): Direction | undefined {
  const name = normalizeName(rawName);
  if (matchesBound(name, LOWER_IS_STRICTER)) return 'lower';
  if (matchesBound(name, HIGHER_IS_STRICTER)) return 'higher';
  return undefined;
}

/** Exact names only: `non-strict` or `disable-strict` must not read as `strict`. */
export function isStrictSwitch(rawName: string): boolean {
  return (STRICT_SWITCHES as readonly string[]).includes(normalizeName(rawName));
}

/** A number, from a YAML number or a numeric word (`80`, `-1`, `90%`). */
function asSigned(value: Node): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?%?$/.test(value)) return undefined;
  return Number.parseFloat(value);
}

/** A non-negative number. To eslint, `--max-warnings -1` means no limit at all. */
function asNumber(value: Node): number | undefined {
  const number = asSigned(value);
  return number !== undefined && number >= 0 ? number : undefined;
}

function isTrue(value: Node): boolean {
  return value === true || value === 'true';
}

function isStricterValue(direction: Direction, before: number, after: number): boolean {
  return direction === 'lower' ? after < before : after > before;
}

/**
 * One judged edit: strictly stricter, plainly looser (a known bound or switch
 * moved the loose way), or a change whose direction is unknown. The last two
 * hold; only a loosening holds on a shipped reusable workflow.
 */
export type Verdict =
  | { stricter: StrengtheningIndicator; detail: string }
  | { looser: LooseningIndicator; detail: string }
  | { changed: string };

export function stricter(kind: StrengtheningIndicator, detail: string): Verdict {
  return { stricter: kind, detail };
}

export function looser(kind: LooseningIndicator, detail: string): Verdict {
  return { looser: kind, detail };
}

export function toIndicator(verdict: Verdict, file: string, location: string): Indicator {
  if ('changed' in verdict) {
    return ambiguousIndicator('check-changed', file, location, verdict.changed);
  }
  return 'looser' in verdict
    ? looseningIndicator(verdict.looser, file, location, verdict.detail)
    : strengtheningIndicator(verdict.stricter, file, location, verdict.detail);
}

/**
 * Judge a known bound or strict switch that appeared, with no value before. A
 * new bound holds: the value already in force (a tool default, a config file,
 * the action's input default) is unknown, so a new one may raise it. Only a
 * strict switch can safely appear, because turning it on can't relax anything.
 */
function judgeAdded(name: string, value: Node): Verdict | undefined {
  if (isStrictSwitch(name) && isTrue(value)) {
    return stricter('strict-enabled', `\`${name}\` turned on.`);
  }
  return undefined;
}

/** Judge one input or flag that disappeared: a known bound or a switch that was on. */
export function judgeRemoved(name: string, value: Node): Verdict | undefined {
  if (directionOf(name) !== undefined && asNumber(value) !== undefined) {
    return looser('threshold-loosened', `\`${name}\` (${String(value)}) was removed.`);
  }
  if (isStrictSwitch(name) && isTrue(value)) {
    return looser('strict-disabled', `\`${name}\` was removed.`);
  }
  return undefined;
}

/** Judge one input or flag whose value changed. */
export function judgeChanged(name: string, before: Node, after: Node): Verdict | undefined {
  const direction = directionOf(name);
  const from = asNumber(before);
  const to = asSigned(after);
  if (direction !== undefined && from !== undefined && to !== undefined) {
    if (to >= 0 && isStricterValue(direction, from, to)) {
      return stricter('threshold-tightened', `\`${name}\` tightened from ${from} to ${to}.`);
    }
    return to === from
      ? undefined
      : looser('threshold-loosened', `\`${name}\` loosened from ${from} to ${to}.`);
  }
  if (isStrictSwitch(name) && !isTrue(before) && isTrue(after)) {
    return stricter('strict-enabled', `\`${name}\` turned on.`);
  }
  if (isStrictSwitch(name) && isTrue(before) && !isTrue(after)) {
    return looser('strict-disabled', `\`${name}\` turned off.`);
  }
  return undefined;
}

/** Every judged edit to a `with:` block of an existing step or reusable-workflow job. */
export function inputIndicators(
  file: string,
  location: string,
  base: Node,
  head: Node,
): Indicator[] {
  if (deepEqual(base, head)) return [];
  const before = asRecord(base) ?? {};
  const after = asRecord(head) ?? {};
  const found: Indicator[] = [];
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const at = `${location}.with.${name}`;
    if (deepEqual(before[name], after[name])) continue;
    // A gained input outside the vocabulary passes, like any field an existing
    // step gains (rmartz/pr-policy#134 tracks that gap). A gained bound holds.
    if (!(name in before) && directionOf(name) === undefined && !isStrictSwitch(name)) continue;
    const verdict = !(name in after)
      ? judgeRemoved(name, before[name])
      : !(name in before)
        ? judgeAdded(name, after[name])
        : judgeChanged(name, before[name], after[name]);
    found.push(
      toIndicator(
        verdict ?? {
          changed: !(name in after)
            ? `Input \`${name}\` was removed.`
            : `Input \`${name}\` changed in a way that isn't known to be stricter.`,
        },
        file,
        at,
      ),
    );
  }
  return found;
}

/**
 * The judged edit to `timeout-minutes`. A lower limit, or a first limit at or
 * under GitHub's default, can only fail more runs. A raised or removed limit is
 * `timeout-raised`, a loosening. An expression is `timeout-changed`.
 */
export function timeoutIndicators(
  file: string,
  location: string,
  base: Node,
  head: Node,
): Indicator[] {
  if (deepEqual(base, head)) return [];
  const at = `${location}.timeout-minutes`;
  const from = base === undefined ? DEFAULT_TIMEOUT_MINUTES : asNumber(base);
  const to = asNumber(head);
  const describe = (value: Node) => JSON.stringify(value) ?? 'unset';
  const limit = head === undefined ? DEFAULT_TIMEOUT_MINUTES : to;
  if (from !== undefined && limit !== undefined && limit === from) return [];
  if (from !== undefined && limit !== undefined && limit > from) {
    return [
      looseningIndicator(
        'timeout-raised',
        file,
        at,
        `\`timeout-minutes\` raised from ${describe(base)} to ${describe(head)}.`,
      ),
    ];
  }
  if (from !== undefined && to !== undefined && to < from) {
    return [
      strengtheningIndicator(
        'timeout-reduced',
        file,
        at,
        `\`timeout-minutes\` lowered from ${describe(base)} to ${describe(head)}.`,
      ),
    ];
  }
  return [
    ambiguousIndicator(
      'timeout-changed',
      file,
      at,
      `\`timeout-minutes\` changed from ${describe(base)} to ${describe(head)}.`,
    ),
  ];
}

/**
 * A step without the fields judged above. With `keepIdentity`, a step known
 * only by its command keeps the identity it is paired by, so in a whole-job
 * comparison its other fields can't match a different step's.
 */
export function withoutJudgedStepFields(step: Node, keepIdentity = false): Node {
  const fields = asRecord(step);
  if (!fields) return step;
  const { run, with: _with, 'timeout-minutes': _timeout, ...kept } = fields;
  const keyless = kept.id === undefined && kept.name === undefined && kept.uses === undefined;
  return keepIdentity && keyless && typeof run === 'string'
    ? { ...kept, run: commandIdentity(run) }
    : kept;
}

/**
 * A copy of the document without the fields judged above, for the containment
 * backstop: those fields' edits are already reported, stricter or not.
 */
export function withoutJudgedFields(doc: Node): Node {
  const root = asRecord(doc);
  const jobs = asRecord(root?.jobs);
  if (!root || !jobs) return doc;
  const stripped: Record<string, Node> = {};
  for (const [id, job] of Object.entries(jobs)) {
    const map = asRecord(job);
    if (!map) {
      stripped[id] = job;
      continue;
    }
    const { with: _with, 'timeout-minutes': _timeout, ...rest } = map;
    const steps = Array.isArray(rest.steps)
      ? rest.steps.map((step: Node) => withoutJudgedStepFields(step, true))
      : rest.steps;
    stripped[id] = steps === undefined ? rest : { ...rest, steps };
  }
  return { ...root, jobs: stripped };
}
