import { describe, expect, it } from 'vitest';
import { decideTitle } from '../../../src/checks/title/index.js';
import { isTestPath } from '../../../src/checks/title/type-paths.js';
import type { PullRequestFacts } from '../../../src/policy.js';

function pr(title: string, changedFiles: string[]): PullRequestFacts {
  return {
    title,
    labels: [],
    changedFiles,
    workflowChanges: [],
    manifestChanges: [],
    signOffs: [],
  };
}

const findings = (title: string, changedFiles: string[]) =>
  decideTitle(pr(title, changedFiles)).findings;

describe('decideTitle — docs changes only Markdown', () => {
  it('passes a docs PR that changes only Markdown, anywhere in the tree', () => {
    expect(
      findings('docs: explain rules', ['docs/checks/title.md', 'README.md', 'AGENTS.MD']),
    ).toEqual([]);
  });

  it.each([
    ['code', 'src/checks/title/index.ts'],
    ['CI', '.github/workflows/ci.yml'],
    ['config', '.repo-hygiene.yml'],
    ['a manifest', 'package.json'],
  ])('blocks a docs PR that changes %s', (_kind, path) => {
    const [finding] = findings('docs(readme): tidy', ['README.md', path]);
    expect(finding?.effect).toBe('block');
    expect(finding?.message).toContain(`\`${path}\``);
    expect(finding?.message).not.toContain('`README.md`');
  });

  it('counts a rename out of code as a code change', () => {
    // pull-request.ts records a rename's old path alongside the new one.
    expect(findings('docs: move notes', ['src/notes.ts', 'docs/notes.md'])).toHaveLength(1);
  });

  it('truncates a long path list', () => {
    const paths = Array.from({ length: 7 }, (_, i) => `src/f${i}.ts`);
    expect(findings('docs: x', paths)[0]?.message).toContain('and 2 more');
  });

  it('leaves other types alone', () => {
    expect(findings('feat: x', ['src/a.ts', 'docs/a.md'])).toEqual([]);
  });
});

describe('decideTitle — refactor leaves tests untouched', () => {
  it('passes a refactor that changes only source', () => {
    expect(findings('refactor(title): extract rules', ['src/checks/title/index.ts'])).toEqual([]);
  });

  it('blocks a refactor that changes a test, and recommends a test: PR first', () => {
    const [finding] = findings('refactor: split module', [
      'src/a.ts',
      'test/checks/title/decide.test.ts',
    ]);
    expect(finding?.effect).toBe('block');
    expect(finding?.message).toContain('`test/checks/title/decide.test.ts`');
    expect(finding?.message).toContain('`test:` PR');
  });

  it('passes a refactor that updates docs, including Markdown under a test directory', () => {
    expect(
      findings('refactor: rename module', ['src/a.ts', 'docs/a.md', 'test/README.md']),
    ).toEqual([]);
  });
});

describe('decideTitle — test changes only tests and docs', () => {
  it('passes a test PR that adds tests, fixtures, and docs without code', () => {
    expect(
      findings('test(title): lock in behaviour', [
        'test/checks/title/new.test.ts',
        'test/fixtures/workflow.yml',
        'src/a.spec.ts',
        'docs/checks/title.md',
      ]),
    ).toEqual([]);
  });

  it.each([
    ['code', 'src/checks/title/index.ts'],
    ['CI', '.github/workflows/ci.yml'],
    ['config', 'vitest.config.ts'],
  ])('blocks a test PR that changes %s', (_kind, path) => {
    const [finding] = findings('test: cover title rules', ['test/a.test.ts', path]);
    expect(finding?.effect).toBe('block');
    expect(finding?.message).toContain(`\`${path}\``);
    expect(finding?.message).not.toContain('`test/a.test.ts`');
  });
});

describe('isTestPath', () => {
  it.each([
    'test/fixtures/workflow.yml',
    'tests/test_foo.py',
    'src/__tests__/a.ts',
    'src/a.test.ts',
    'src/a.spec.tsx',
    'pkg/test_util.py',
    'pkg/util_test.py',
    'cmd/main_test.go',
  ])('recognises %s', (path) => {
    expect(isTestPath(path)).toBe(true);
  });

  it.each(['src/testing.ts', 'src/contest/a.ts', 'docs/test.md', 'src/latest.ts', 'attest.py'])(
    'does not flag %s',
    (path) => {
      expect(isTestPath(path)).toBe(false);
    },
  );
});
