// The sign-off classifier is public API: rmartz/pr-lifecycle imports it to
// show the labels this gate enforces. Test it only through the package entry.
import { describe, expect, it } from 'vitest';
import {
  classifySignOff,
  type FileChange,
  type RepoConfig,
  type SignOffFacts,
} from '../../src/index.js';
import { BASE_WORKFLOW, WORKFLOW_PATH, edited } from '../checks/ci-change/fixtures/workflow.js';

const UAT_OFF: RepoConfig = { uat: 'off' };

function facts(
  title: string,
  changedFiles: string[],
  workflowChanges: FileChange[] = [],
): SignOffFacts {
  return { title, changedFiles, workflowChanges, manifestChanges: [] };
}

const loosening: FileChange = {
  path: WORKFLOW_PATH,
  baseText: BASE_WORKFLOW,
  headText: edited('timeout-minutes: 5', 'timeout-minutes: 5\n    continue-on-error: true'),
};

const tightening: FileChange = {
  path: WORKFLOW_PATH,
  baseText: BASE_WORKFLOW,
  headText: edited(
    '        run: pnpm test\n',
    '        run: pnpm test\n      - name: Lint\n        run: pnpm lint\n',
  ),
};

describe('classifySignOff — none', () => {
  it.each([
    ['docs', 'docs: explain the gate', ['README.md']],
    ['test', 'test: cover the parser', ['test/parser.test.ts']],
    ['refactor', 'refactor(auth): split the session module', ['src/auth/session.ts']],
  ])('passes a `%s` title, which the title rules path-check', (type, title, paths) => {
    const result = classifySignOff(facts(title, paths));
    expect(result.kind).toBe('none');
    expect(result.reason).toContain(`\`${type}\``);
  });

  it('passes a PR whose every path is trivial, and names the categories', () => {
    const result = classifySignOff(facts('feat: x', ['docs/a.md', 'pnpm-lock.yaml']));
    expect(result).toEqual({
      kind: 'none',
      reason: 'No UAT needed: the PR changes only docs, dependencies.',
    });
  });

  it('passes any PR when the repo turns UAT off', () => {
    expect(classifySignOff(facts('feat: add a page', ['src/page.tsx']), UAT_OFF).kind).toBe('none');
  });

  it('reads the title past a WIP marker', () => {
    expect(classifySignOff(facts('[WIP] refactor: split', ['src/a.ts'])).kind).toBe('none');
  });

  it('passes a ci PR whose workflow change only tightens CI', () => {
    expect(classifySignOff(facts('ci: lint too', [WORKFLOW_PATH], [tightening])).kind).toBe('none');
  });
});

describe('classifySignOff — ci', () => {
  it('asks for the CI sign-off on a ci PR that loosens CI, with the evidence', () => {
    const result = classifySignOff(facts('ci: tolerate flaky build', [WORKFLOW_PATH], [loosening]));
    expect(result.kind).toBe('ci');
    expect(result.kind === 'ci' && result.indicators.map((i) => i.kind)).toContain(
      'continue-on-error-added',
    );
  });

  it('never also asks for UAT, even with UAT on and non-trivial paths', () => {
    // Mutual exclusivity: a person on the CI change is never asked for UAT too.
    const result = classifySignOff(
      facts('ci: tolerate flaky build', [WORKFLOW_PATH, 'eslint.config.mjs'], [loosening]),
    );
    expect(result.kind).toBe('ci');
  });

  it('still asks for the CI sign-off when the repo turns UAT off', () => {
    const result = classifySignOff(
      facts('ci(release): skip', [WORKFLOW_PATH], [loosening]),
      UAT_OFF,
    );
    expect(result.kind).toBe('ci');
  });

  it('leaves a loosening bundled into another type to the review, as UAT', () => {
    // ci-change still holds it for the CI sign-off on its own.
    const result = classifySignOff(facts('feat: add x', [WORKFLOW_PATH, 'src/x.ts'], [loosening]));
    expect(result.kind).toBe('uat');
  });
});

describe('classifySignOff — uat', () => {
  it.each([
    ['feat: add a page', ['src/page.tsx']],
    ['fix: stop the crash', ['src/a.ts', 'docs/a.md']],
    ['chore: restructure modules', ['src/a/index.ts']],
    ['ci: add an audit script', ['scripts/audit.mjs']],
    ['not a conventional title', ['src/a.ts']],
  ])('asks for UAT on `%s`', (title, paths) => {
    expect(classifySignOff(facts(title, paths)).kind).toBe('uat');
  });
});
