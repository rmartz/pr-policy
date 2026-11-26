/**
 * Step-level rules: which steps a job lost, and the per-step guards.
 */
import { ambiguousIndicator, looseningIndicator, type Indicator } from './indicators.js';
import { guardIndicators } from './common-rules.js';
import { runIndicators } from './run-rules.js';
import { inputIndicators, withoutJudgedStepFields } from './stricter.js';
import {
  asArray,
  asRecord,
  commandIdentity,
  containsAll,
  deepEqual,
  normalizeUses,
  stripActionRef,
  type Node,
} from './structure.js';

/** The `steps:` sequence of a job, or `[]` when the job declares none. */
export function stepsOf(job: Node): Node[] {
  return asArray(asRecord(job)?.steps) ?? [];
}

/**
 * A stable identity for a step, used to pair base and head steps.
 *
 * Index is deliberately *not* part of the identity: reordering steps is not a
 * loosening, and an index-based pairing would report every step after an
 * insertion as removed. The fallbacks descend from most to least explicit, and a
 * step with none of them falls back to its own serialized content — which pairs
 * an untouched step with itself and treats an edited one as a replacement. A
 * step keyed by its `run:` text gets a second chance in {@link pairSteps}.
 */
export function stepKey(step: Node): string {
  const map = asRecord(step);
  if (!map) return JSON.stringify(step ?? null);
  const { id, name, uses, run } = map;
  if (typeof id === 'string') return `id:${id}`;
  if (typeof name === 'string') return `name:${name}`;
  if (typeof uses === 'string') return `uses:${stripActionRef(uses)}`;
  if (typeof run === 'string') return `run:${run}`;
  return `step:${JSON.stringify(map)}`;
}

interface KeyedStep {
  key: string;
  step: Node;
}

/** A base step and the head step it is compared with. */
interface StepPair extends KeyedStep {
  counterpart: Node;
}

function groupByKey(steps: readonly Node[]): Map<string, Node[]> {
  const groups = new Map<string, Node[]>();
  for (const step of steps) {
    const key = stepKey(step);
    groups.set(key, [...(groups.get(key) ?? []), step]);
  }
  return groups;
}

const isRunKey = (key: string) => key.startsWith('run:');

/** The executable and subcommand of a command-keyed step (`pnpm lint`). */
const leadingWords = (key: string) => commandIdentity(key.slice('run:'.length));

/** A step without the labels that name it, to recognise a rename. */
function unnamed(step: Node): Node {
  const fields = asRecord(step);
  if (!fields) return step;
  const { id: _id, name: _name, ...rest } = fields;
  return rest;
}

/**
 * Pair every base step with the head step it became, or report it removed.
 *
 * A step whose `id:` or `name:` alone changed is paired as renamed, not removed.
 * Steps sharing a key (two `actions/cache` steps) are paired by content first,
 * so a new same-keyed step inserted before an old one is an addition, and only
 * the leftovers are paired in order. A step known only by its command has its
 * `run:` text as its key, so editing the command would read as a removal: a
 * vanished one is paired with an appeared one that starts with the same words
 * (`pnpm lint`), and is a removal otherwise.
 */
export function pairSteps(
  base: readonly Node[],
  head: readonly Node[],
): { pairs: StepPair[]; removed: KeyedStep[] } {
  const before = groupByKey(base);
  const after = groupByKey(head);
  const pairs: StepPair[] = [];
  const unpaired: KeyedStep[] = [];
  const appeared: KeyedStep[] = [];

  for (const [key, steps] of before) {
    const candidates = [...(after.get(key) ?? [])];
    const leftover = steps.filter((step) => {
      const at = candidates.findIndex((candidate) =>
        deepEqual(normalizeUses(step), normalizeUses(candidate)),
      );
      if (at === -1) return true;
      pairs.push({ key, step, counterpart: candidates.splice(at, 1)[0] });
      return false;
    });
    for (const step of leftover) {
      const counterpart = candidates.shift();
      if (counterpart === undefined) unpaired.push({ key, step });
      else pairs.push({ key, step, counterpart });
    }
    appeared.push(...candidates.map((step) => ({ key, step })));
  }
  for (const [key, steps] of after) {
    if (!before.has(key)) appeared.push(...steps.map((step) => ({ key, step })));
  }

  const removed = unpaired.filter(({ key, step }) => {
    // Renamed in place: the same step with only its `id:` or `name:` changed.
    const renamed = appeared.findIndex((candidate) =>
      deepEqual(normalizeUses(unnamed(step)), normalizeUses(unnamed(candidate.step))),
    );
    if (renamed !== -1) {
      pairs.push({ key, step, counterpart: appeared.splice(renamed, 1)[0]?.step });
      return false;
    }
    if (!isRunKey(key)) return true;
    const at = appeared.findIndex(
      (candidate) => isRunKey(candidate.key) && leadingWords(candidate.key) === leadingWords(key),
    );
    if (at === -1) return true;
    pairs.push({ key, step, counterpart: appeared.splice(at, 1)[0]?.step });
    return false;
  });
  return { pairs, removed };
}

/** Removed steps, the per-step guards, and edits to each kept step's command and inputs. */
export function stepIndicators(file: string, jobId: string, base: Node, head: Node): Indicator[] {
  const { pairs, removed } = pairSteps(stepsOf(base), stepsOf(head));
  const at = (key: string) => `jobs.${jobId}.steps[${key}]`;
  return [
    ...removed.map(({ key }) =>
      looseningIndicator('step-removed', file, at(key), `Step \`${key}\` was removed.`),
    ),
    ...pairs.flatMap(({ key, step, counterpart }) => [
      // Each step's other fields are compared with its own counterpart, so a
      // decoy step can't carry the old context for a step whose context changed.
      ...(containsAll(
        normalizeUses(withoutJudgedStepFields(step)),
        normalizeUses(withoutJudgedStepFields(counterpart)),
      )
        ? []
        : [
            ambiguousIndicator(
              'unclassified-change',
              file,
              at(key),
              'The step changed outside its command, inputs, and timeout, in a way no rule recognises.',
            ),
          ]),
      ...guardIndicators(file, at(key), step, counterpart),
      ...runIndicators(file, at(key), asRecord(step)?.run, asRecord(counterpart)?.run),
      ...inputIndicators(file, at(key), asRecord(step)?.with, asRecord(counterpart)?.with),
    ]),
  ];
}
