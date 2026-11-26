/**
 * Step-level rules: which steps a job lost, and the per-step guards.
 */
import { looseningIndicator, type Indicator } from './indicators.js';
import { guardIndicators } from './common-rules.js';
import { runIndicators } from './run-rules.js';
import { inputIndicators } from './stricter.js';
import { asArray, asRecord, stripActionRef, type Node } from './structure.js';

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
 * step keyed by its `run:` text gets a second chance in {@link pairCommandSteps}.
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

function byKey(steps: readonly Node[]): Map<string, Node> {
  const index = new Map<string, Node>();
  const seen = new Map<string, number>();
  for (const step of steps) {
    const key = stepKey(step);
    // A repeated key (two `actions/cache` steps) gets its occurrence number, so
    // every step is paired and judged, not only the first of each key.
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    index.set(count === 1 ? key : `${key}#${count}`, step);
  }
  return index;
}

const isRunKey = (key: string) => key.startsWith('run:');

/**
 * Pair the steps known only by their command. Such a step's key *is* its
 * `run:` text, so editing the command would read as a removal. When the same
 * number of command-keyed steps vanished as appeared, they are paired in order
 * and their commands compared instead; otherwise the vanished ones are removals.
 */
function pairCommandSteps(before: Map<string, Node>, after: Map<string, Node>): Map<string, Node> {
  const vanished = [...before.keys()].filter((key) => isRunKey(key) && !after.has(key));
  const appeared = [...after.keys()].filter((key) => isRunKey(key) && !before.has(key));
  const paired = new Map<string, Node>();
  if (vanished.length !== appeared.length) return paired;
  vanished.forEach((key, i) => {
    const counterpart = appeared[i];
    if (counterpart !== undefined) paired.set(key, after.get(counterpart));
  });
  return paired;
}

/** Removed steps, the per-step guards, and edits to each kept step's command and inputs. */
export function stepIndicators(file: string, jobId: string, base: Node, head: Node): Indicator[] {
  const before = byKey(stepsOf(base));
  const after = byKey(stepsOf(head));
  const edited = pairCommandSteps(before, after);
  const found: Indicator[] = [];

  for (const [key, step] of before) {
    const location = `jobs.${jobId}.steps[${key}]`;
    const counterpart = after.get(key) ?? edited.get(key);
    if (counterpart === undefined) {
      found.push(
        looseningIndicator('step-removed', file, location, `Step \`${key}\` was removed.`),
      );
      continue;
    }
    found.push(
      ...guardIndicators(file, location, step, counterpart),
      ...runIndicators(file, location, asRecord(step)?.run, asRecord(counterpart)?.run),
      ...inputIndicators(file, location, asRecord(step)?.with, asRecord(counterpart)?.with),
    );
  }

  return found;
}
