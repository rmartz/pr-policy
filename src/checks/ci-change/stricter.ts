/**
 * Strictly-stricter edits to an existing check, told apart from other edits.
 *
 * A workflow diff can't say what a tool's flag means, so "stricter" is read
 * from a small, explicit vocabulary of bounds whose direction is known (see
 * {@link LOWER_IS_STRICTER}). Anything outside it is a change to what the check
 * enforces, and holds: a false hold costs one label, a false pass skips the
 * sign-off (docs/decisions.md).
 *
 * Three fields of an existing job or step are judged here, and only here: a
 * step's `run:` command, a step's or reusable-workflow job's `with:` inputs,
 * and `timeout-minutes`. The containment backstop ignores them for that reason.
 */
import {
  ambiguousIndicator,
  strengtheningIndicator,
  type Indicator,
  type StrengtheningIndicator,
} from './indicators.js';
import { asRecord, deepEqual, type Node } from './structure.js';

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
  'min-coverage',
  'minimum-coverage',
  'coverage-threshold',
] as const;

/** Switches that only ever make a tool reject more when turned on. */
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
 * A vocabulary entry matches the whole name or its last dash-separated words
 * (`cov-fail-under`). A negated name (`no-strict`) never matches.
 */
function matches(name: string, vocabulary: readonly string[]): boolean {
  if (name.startsWith('no-') || name.includes('-no-')) return false;
  return vocabulary.some((entry) => name === entry || name.endsWith(`-${entry}`));
}

function directionOf(rawName: string): Direction | undefined {
  const name = normalizeName(rawName);
  if (matches(name, LOWER_IS_STRICTER)) return 'lower';
  if (matches(name, HIGHER_IS_STRICTER)) return 'higher';
  return undefined;
}

function isStrictSwitch(rawName: string): boolean {
  return matches(normalizeName(rawName), STRICT_SWITCHES);
}

function asNumber(value: Node): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?%?$/.test(value)) return undefined;
  return Number.parseFloat(value);
}

function isTrue(value: Node): boolean {
  return value === true || value === 'true';
}

function isStricterValue(direction: Direction, before: number, after: number): boolean {
  return direction === 'lower' ? after < before : after > before;
}

/** One judged edit: a strictly stricter one, or a change that holds. */
type Verdict = { stricter: StrengtheningIndicator; detail: string } | { changed: string };

function stricter(kind: StrengtheningIndicator, detail: string): Verdict {
  return { stricter: kind, detail };
}

function toIndicator(verdict: Verdict, file: string, location: string): Indicator {
  return 'changed' in verdict
    ? ambiguousIndicator('check-changed', file, location, verdict.changed)
    : strengtheningIndicator(verdict.stricter, file, location, verdict.detail);
}

/** Judge one input or flag that appeared, with no value before. */
function judgeAdded(name: string, value: Node): Verdict | undefined {
  if (directionOf(name) !== undefined && asNumber(value) !== undefined) {
    return stricter(
      'threshold-tightened',
      `\`${name}\` set to ${String(value)} where it had no bound.`,
    );
  }
  if (isStrictSwitch(name) && isTrue(value)) {
    return stricter('strict-enabled', `\`${name}\` turned on.`);
  }
  return undefined;
}

/** Judge one input or flag whose value changed. */
function judgeChanged(name: string, before: Node, after: Node): Verdict | undefined {
  const direction = directionOf(name);
  const from = asNumber(before);
  const to = asNumber(after);
  if (direction !== undefined && from !== undefined && to !== undefined) {
    return isStricterValue(direction, from, to)
      ? stricter('threshold-tightened', `\`${name}\` tightened from ${from} to ${to}.`)
      : undefined;
  }
  if (isStrictSwitch(name) && !isTrue(before) && isTrue(after)) {
    return stricter('strict-enabled', `\`${name}\` turned on.`);
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
    const verdict = !(name in after)
      ? undefined
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

/** Shell words, with `--flag=value` split into `--flag` and `value`. */
function words(command: string): string[] {
  return command
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .flatMap((word) => {
      const flag = /^(-{1,2}[A-Za-z][\w-]*)=(.*)$/.exec(word);
      return flag ? [flag[1] ?? word, flag[2] ?? ''] : [word];
    });
}

/** How many words an inserted stricter flag takes at `at`, with its verdict, or `undefined`. */
function insertedFlag(head: readonly string[], at: number): [number, Verdict] | undefined {
  const flag = head[at];
  if (flag === undefined || !flag.startsWith('-')) return undefined;
  const value = head[at + 1];
  if (directionOf(flag) !== undefined && value !== undefined) {
    const verdict = judgeAdded(flag, value);
    if (verdict) return [2, verdict];
  }
  if (isStrictSwitch(flag) && (value === undefined || value.startsWith('-'))) {
    return [1, stricter('strict-enabled', `\`${flag}\` added.`)];
  }
  return undefined;
}

/**
 * Judge an edited `run:` command. It is strictly stricter only when the head is
 * the base with known bounds tightened or known stricter flags inserted, word for
 * word otherwise. Any other edit, even an appended command, holds: a workflow
 * diff can't tell `pnpm test` from `pnpm test || true` by intent.
 */
function judgeRun(base: string, head: string): Verdict[] {
  const before = words(base);
  const after = words(head);
  const verdicts: Verdict[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    const [from, to] = [before[i], after[j]];
    if (from !== undefined && from === to) {
      i += 1;
      j += 1;
      continue;
    }
    const flag = i > 0 && before[i - 1] === after[j - 1] ? before[i - 1] : undefined;
    if (flag !== undefined && from !== undefined && to !== undefined) {
      const verdict = directionOf(flag) !== undefined ? judgeChanged(flag, from, to) : undefined;
      if (verdict) {
        verdicts.push(verdict);
        i += 1;
        j += 1;
        continue;
      }
    }
    const inserted = insertedFlag(after, j);
    if (inserted) {
      verdicts.push(inserted[1]);
      j += inserted[0];
      continue;
    }
    return [{ changed: "The command changed in a way that isn't known to be stricter." }];
  }
  return verdicts;
}

/** The judged edit to a `run:` command of an existing step. */
export function runIndicators(file: string, location: string, base: Node, head: Node): Indicator[] {
  if (deepEqual(base, head)) return [];
  const at = `${location}.run`;
  if (typeof base !== 'string' || typeof head !== 'string') {
    return [
      ambiguousIndicator('check-changed', file, at, 'The `run:` command was added or removed.'),
    ];
  }
  return judgeRun(base, head).map((verdict) => toIndicator(verdict, file, at));
}

/**
 * The judged edit to `timeout-minutes`. A lower limit, or a first limit at or
 * under GitHub's default, can only fail more runs. Anything else (a raise, a
 * removal, an expression) is `timeout-changed`, which holds.
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
  if (from !== undefined && to !== undefined && to <= from) {
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
      ? rest.steps.map((step: Node) => {
          const fields = asRecord(step);
          if (!fields) return step;
          const { run: _run, with: _stepWith, 'timeout-minutes': _stepTimeout, ...kept } = fields;
          return kept;
        })
      : rest.steps;
    stripped[id] = steps === undefined ? rest : { ...rest, steps };
  }
  return { ...root, jobs: stripped };
}
