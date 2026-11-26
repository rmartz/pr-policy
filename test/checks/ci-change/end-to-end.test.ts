import { describe, expect, it } from 'vitest';
import { ciChangeCheck } from '../../../src/checks/ci-change/index.js';
import { CI_APPROVAL_NEEDED_LABEL } from '../../../src/contract.js';
import type { FileChange, PullRequestFacts } from '../../../src/policy.js';
import { BASE_WORKFLOW, WORKFLOW_PATH, edited } from './fixtures/workflow.js';

const SHIPPED_PATH = '.github/workflows/deploy.yml';

/** A shipped reusable workflow: `workflow_call` is its only trigger. */
const SHIPPED_WORKFLOW = `name: Deploy
on:
  workflow_call:
    inputs:
      target:
        type: string
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Gate
        run: ./gate.sh
      - name: Deploy
        if: github.event.action != 'closed'
        run: ./deploy.sh
`;

const ci = (headText: string): FileChange => ({
  path: WORKFLOW_PATH,
  baseText: BASE_WORKFLOW,
  headText,
});

const shipped = (find: string, replace: string): FileChange => ({
  path: SHIPPED_PATH,
  baseText: SHIPPED_WORKFLOW,
  headText: SHIPPED_WORKFLOW.replace(find, replace),
});

/** Run the check over a PR that changes `workflowChanges` plus `productFiles`. */
async function run(workflowChanges: FileChange[], productFiles: string[] = []) {
  const facts: PullRequestFacts = {
    title: 'feat: a change',
    labels: [],
    changedFiles: [...workflowChanges.map((change) => change.path), ...productFiles],
    workflowChanges,
    manifestChanges: [],
    signOffs: [],
  };
  const result = await ciChangeCheck.evaluate(facts);
  return {
    held: result.findings.some((finding) => finding.effect === 'hold'),
    labelled: (result.labelsToAdd ?? []).includes(CI_APPROVAL_NEEDED_LABEL),
    messages: result.findings.map((finding) => finding.message),
  };
}

const NEW_JOB = `${BASE_WORKFLOW}  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm lint\n`;

describe('ci-change end to end', () => {
  it('passes a new job alone, with no label', async () => {
    expect(await run([ci(NEW_JOB)])).toMatchObject({ held: false, labelled: false });
  });

  it('passes a new job alongside product code: mixing alone never holds', async () => {
    const outcome = await run([ci(NEW_JOB)], ['src/feature.ts', 'README.md']);
    expect(outcome).toMatchObject({ held: false, labelled: false });
  });

  it('passes an existing check made strictly stricter, and shows why', async () => {
    const base = edited('        run: pnpm test', '        run: pnpm eslint . --max-warnings 5');
    const head = edited('        run: pnpm test', '        run: pnpm eslint . --max-warnings 0');
    const outcome = await run([{ path: WORKFLOW_PATH, baseText: base, headText: head }]);
    expect(outcome).toMatchObject({ held: false, labelled: false });
    expect(outcome.messages.join('\n')).toContain('threshold-tightened (strengthening)');
  });

  it('holds and labels an existing check changed in a way that is not stricter', async () => {
    const outcome = await run([
      ci(edited('        run: pnpm test', '        run: pnpm test:unit')),
    ]);
    expect(outcome).toMatchObject({ held: true, labelled: true });
    expect(outcome.messages.join('\n')).toContain('check-changed');
  });

  it('holds and labels a loosening', async () => {
    const outcome = await run([ci(edited('        node: [20, 22]', '        node: [22]'))]);
    expect(outcome).toMatchObject({ held: true, labelled: true });
  });

  it('holds a loosening of a shipped reusable workflow', async () => {
    const outcome = await run([shipped('      - name: Gate\n        run: ./gate.sh\n', '')]);
    expect(outcome).toMatchObject({ held: true, labelled: true });
    expect(outcome.messages.join('\n')).toContain('step-removed');
  });

  it('holds a shipped reusable workflow whose command now swallows a failure', async () => {
    const outcome = await run([shipped('run: ./gate.sh', 'run: ./gate.sh || true')]);
    expect(outcome).toMatchObject({ held: true, labelled: true });
    expect(outcome.messages.join('\n')).toContain('failure-ignored');
  });

  it('holds a CI workflow converted to workflow_call only', async () => {
    const converted: FileChange = {
      path: WORKFLOW_PATH,
      baseText: BASE_WORKFLOW,
      headText: BASE_WORKFLOW.replace(
        /^on:\n(?: {2}.*\n| {4}.*\n)+/m,
        'on: workflow_call\n',
      ).replace('run: pnpm test', 'run: pnpm test:unit'),
    };
    const outcome = await run([converted]);
    expect(outcome).toMatchObject({ held: true, labelled: true });
    expect(outcome.messages.join('\n')).toContain('trigger-narrowed');
  });

  it('passes a shipped reusable workflow edit that does not loosen it', async () => {
    const edit = shipped(
      "if: github.event.action != 'closed'",
      "if: github.event.action == 'opened'",
    );
    const outcome = await run([edit], ['README.md']);
    expect(outcome).toMatchObject({ held: false, labelled: false });
    expect(outcome.messages.join('\n')).toContain('Shipped reusable workflow, not CI');
  });
});
