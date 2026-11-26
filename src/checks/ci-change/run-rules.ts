/**
 * The `run:` command of a step kept on both sides: whether it now swallows
 * failures (a loosening), was made strictly stricter, or changed some other
 * way (`check-changed`, which holds). The vocabulary lives in stricter.ts.
 */
import { ambiguousIndicator, looseningIndicator, type Indicator } from './indicators.js';
import {
  directionOf,
  isStrictSwitch,
  judgeChanged,
  stricter,
  toIndicator,
  type Verdict,
} from './stricter.js';
import { deepEqual, type Node } from './structure.js';

/** Shell idioms that make a failing command succeed. */
const SWALLOWS_FAILURE = [/\|\|\s*(true|:)(?=\s|;|$)/gm, /\|\|\s*exit\s+0\b/gm, /\bset\s+\+e\b/gm];

function swallowCount(command: string): number {
  return SWALLOWS_FAILURE.reduce((total, idiom) => total + (command.match(idiom)?.length ?? 0), 0);
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

/**
 * A strict switch inserted as a bare flag at `at`. A bound inserted where there
 * was none isn't stricter: the value already in force is unknown, and a later
 * duplicate of a flag overrides an earlier one.
 */
function insertedSwitch(head: readonly string[], at: number): Verdict | undefined {
  const flag = head[at];
  if (flag === undefined || !flag.startsWith('-') || !isStrictSwitch(flag)) return undefined;
  const value = head[at + 1];
  // Followed by nothing, another flag, or a shell operator: a bare switch, not `--strict false`.
  return value === undefined || value.startsWith('-') || /^(\|\|?|&&|;)$/.test(value)
    ? stricter('strict-enabled', `\`${flag}\` added.`)
    : undefined;
}

/**
 * Judge an edited command. It is strictly stricter only when the head is the
 * base with known bounds tightened or strict switches inserted, word for word
 * otherwise. Any other edit, even an appended command, holds: a workflow diff
 * can't tell `pnpm test && pnpm lint` from a replaced check by intent.
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
    const inserted = insertedSwitch(after, j);
    if (inserted) {
      verdicts.push(inserted);
      j += 1;
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
  if (swallowCount(head) > swallowCount(base)) {
    return [
      looseningIndicator(
        'failure-ignored',
        file,
        at,
        'The command now swallows a failure (`|| true`, `|| :`, `|| exit 0`, or `set +e`).',
      ),
    ];
  }
  return judgeRun(base, head).map((verdict) => toIndicator(verdict, file, at));
}
