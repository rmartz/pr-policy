/**
 * The `run:` command of a step kept on both sides: whether it now swallows
 * failures (a loosening), was made strictly stricter or had a check appended
 * with `&&` (strengthening), or changed some other way (`check-changed`, which
 * holds). The vocabulary lives in stricter.ts.
 */
import {
  ambiguousIndicator,
  looseningIndicator,
  strengtheningIndicator,
  type Indicator,
} from './indicators.js';
import {
  directionOf,
  isStrictSwitch,
  judgeChanged,
  judgeRemoved,
  looser,
  stricter,
  toIndicator,
  type Verdict,
} from './stricter.js';
import { deepEqual, type Node } from './structure.js';

/**
 * Shell forms that can make a failing command succeed: any `||` (its right side
 * runs, and decides the status, when the left side fails), `exit 0`, and
 * `set +e`. A newly added one is a loosening wherever it guards.
 */
const SWALLOWS_FAILURE = [/\|\|/g, /(^|;|&&)\s*exit\s+0\b/gm, /\bset\s+\+e\b/gm];

function swallowCount(command: string): number {
  return SWALLOWS_FAILURE.reduce((total, idiom) => total + (command.match(idiom)?.length ?? 0), 0);
}

/**
 * Shell words, with `--flag=value` split into `--flag` and `value`. A line break
 * is a word of its own (`\n`), so joining two lines is an edit, not a no-op.
 */
function words(command: string): string[] {
  const lines = command
    .trim()
    .split('\n')
    .map((line) =>
      line
        .trim()
        .split(/\s+/)
        .filter((word) => word.length > 0)
        .flatMap((word) => {
          const flag = /^(-{1,2}[A-Za-z][\w-]*)=(.*)$/.exec(word);
          return flag ? [flag[1] ?? word, flag[2] ?? ''] : [word];
        }),
    )
    .filter((line) => line.length > 0);
  return lines.flatMap((line, index) => (index === 0 ? line : ['\n', ...line]));
}

/**
 * The command appended to `base` with `&&`, when `head` is exactly that: the
 * whole base, then `&& <one simple command>`. No newline, `;`, `|`, `&`,
 * grouping, or substitution may follow, since any of them can decide the step's
 * status instead of the base (under `bash -e` a failure inside an `&&` list
 * doesn't stop the script).
 */
function appendedCheck(base: string, head: string): string | undefined {
  const prefix = base.trimEnd();
  const whole = head.trimEnd();
  if (!whole.startsWith(prefix)) return undefined;
  const tail = /^[ \t]*&&[ \t]*([^;&|\n(){}`$<>]+)$/.exec(whole.slice(prefix.length));
  return tail?.[1]?.trim() || undefined;
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

/** A known bound (with its value) or a bare strict switch removed at `at`, with its width. */
function removedFlag(base: readonly string[], at: number): [number, Verdict] | undefined {
  const flag = base[at];
  if (flag === undefined || !flag.startsWith('-')) return undefined;
  const value = base[at + 1];
  if (directionOf(flag) !== undefined && value !== undefined) {
    const verdict = judgeRemoved(flag, value);
    if (verdict) return [2, verdict];
  }
  return isStrictSwitch(flag)
    ? [1, looser('strict-disabled', `\`${flag}\` was removed.`)]
    : undefined;
}

/**
 * Judge an edited command. It is strictly stricter only when the head is the
 * base with known bounds tightened or strict switches inserted, word for word
 * otherwise. A known bound loosened or removed, or a strict switch removed, is
 * a loosening. Any other edit holds (a pure `&&` append is judged before this,
 * by {@link appendedCheck}).
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
    // When both an insertion and a removal fit, take the one after which the
    // two commands line up again.
    const inserted = insertedSwitch(after, j);
    const removed = removedFlag(before, i);
    if (inserted && (!removed || after[j + 1] === from)) {
      verdicts.push(inserted);
      j += 1;
      continue;
    }
    if (removed) {
      verdicts.push(removed[1]);
      i += removed[0];
      continue;
    }
    // A loosening already seen still holds as one, even on a shipped workflow.
    return [
      ...verdicts.filter((verdict) => 'looser' in verdict),
      { changed: "The command changed in a way that isn't known to be stricter." },
    ];
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
        'The command can now succeed when a check in it fails (a new `||`, `exit 0`, or `set +e`).',
      ),
    ];
  }
  const appended = appendedCheck(base, head);
  if (appended !== undefined) {
    return [
      strengtheningIndicator('check-appended', file, at, `\`${appended}\` appended with \`&&\`.`),
    ];
  }
  return judgeRun(base, head).map((verdict) => toIndicator(verdict, file, at));
}
