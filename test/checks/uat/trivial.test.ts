import { describe, expect, it } from 'vitest';
import { trivialCategories } from '../../../src/checks/uat/trivial.js';
import type { FileChange, PullRequestFacts } from '../../../src/policy.js';

function pr(changedFiles: string[], overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
  return {
    title: 'chore: x',
    labels: [],
    changedFiles,
    workflowChanges: [],
    manifestChanges: [],
    signOffs: [],
    ...overrides,
  };
}

const manifest = (base: object, head: object): FileChange[] => [
  { path: 'package.json', baseText: JSON.stringify(base), headText: JSON.stringify(head) },
];

describe('trivialCategories — exempt categories', () => {
  it.each([
    ['docs', ['README.md', 'docs/guide.md', 'src/cli/AGENTS.md', 'docs/diagram.svg']],
    [
      'tests',
      [
        'test/a.test.ts',
        'src/lib/a.spec.tsx',
        'src/__tests__/b.ts',
        'e2e/login.ts',
        'tests/test_cli.py',
        'conftest.py',
      ],
    ],
    ['ci', ['.github/workflows/ci.yml', '.github/actions/setup/action.yml']],
    ['dependencies', ['pnpm-lock.yaml', 'requirements-dev.txt', 'poetry.lock']],
    ['metadata', ['.github/dependabot.yml', '.github/CODEOWNERS', 'LICENSE', '.gitignore']],
  ])('exempts a %s-only PR', (category, files) => {
    expect(trivialCategories(pr(files))).toEqual([category]);
  });

  it('exempts a PR that touches nothing', () => {
    expect(trivialCategories(pr([]))).toEqual([]);
  });
});

describe('trivialCategories — anything else holds', () => {
  it.each([
    ['source code', ['docs/a.md', 'src/a.ts']],
    ['an MDX page, which renders as UI', ['src/stories/Intro.mdx']],
    ['a root config file', ['next.config.ts']],
    ['a script', ['scripts/build.mjs']],
    ['a Storybook story', ['src/Button.stories.tsx']],
  ])('does not exempt %s', (_what, files) => {
    expect(trivialCategories(pr(files))).toBeUndefined();
  });

  it('counts a shipped reusable workflow as product code, not CI', () => {
    const shipped: FileChange = {
      path: '.github/workflows/screenshots.yml',
      baseText: 'on: workflow_call\njobs: {}\n',
      headText: 'on: workflow_call\njobs: { a: {} }\n',
    };
    expect(trivialCategories(pr([shipped.path], { workflowChanges: [shipped] }))).toBeUndefined();
  });
});

describe('trivialCategories — dependency manifests', () => {
  const base = { name: 'x', scripts: { build: 'tsup' }, dependencies: { yaml: '^2.8.0' } };

  it('exempts a manifest change to dependency versions only', () => {
    const head = { ...base, dependencies: { yaml: '^2.9.0' }, packageManager: 'pnpm@10.1.0' };
    const facts = pr(['package.json', 'pnpm-lock.yaml'], { manifestChanges: manifest(base, head) });
    expect(trivialCategories(facts)).toEqual(['dependencies']);
  });

  it.each([
    ['scripts', { ...base, scripts: { build: 'tsc' } }],
    ['pnpm.overrides', { ...base, pnpm: { overrides: { jose: '^5.10.0' } } }],
    ['exports', { ...base, exports: './dist/index.js' }],
  ])('does not exempt a manifest that also changes %s', (_field, head) => {
    const facts = pr(['package.json'], { manifestChanges: manifest(base, head) });
    expect(trivialCategories(facts)).toBeUndefined();
  });

  it('does not exempt a manifest whose contents it never saw', () => {
    expect(trivialCategories(pr(['package.json']))).toBeUndefined();
  });

  it('does not exempt an added manifest', () => {
    const added: FileChange[] = [{ path: 'package.json', headText: JSON.stringify(base) }];
    expect(trivialCategories(pr(['package.json'], { manifestChanges: added }))).toBeUndefined();
  });
});
