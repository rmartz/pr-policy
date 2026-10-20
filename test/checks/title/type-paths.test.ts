import { describe, expect, it } from 'vitest';
import { decideTitle } from '../../../src/checks/title/index.js';
import type { FileChange, PullRequestFacts } from '../../../src/policy.js';

function pr(
  title: string,
  changedFiles: string[],
  overrides: Partial<PullRequestFacts> = {},
): PullRequestFacts {
  return {
    title,
    labels: [],
    changedFiles,
    workflowChanges: [],
    manifestChanges: [],
    signOffs: [],
    ...overrides,
  };
}

const findings = (
  title: string,
  changedFiles: string[],
  overrides: Partial<PullRequestFacts> = {},
) => decideTitle(pr(title, changedFiles, overrides)).findings;

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

  it('counts a snapshot as a test', () => {
    expect(findings('test: update snapshots', ['src/__snapshots__/a.test.ts.snap'])).toEqual([]);
  });

  it('counts a Storybook story as a test', () => {
    expect(
      findings('test(auth): add a story', [
        'src/app/(auth)/forgot-password/ForgotPasswordFormView.stories.tsx',
      ]),
    ).toEqual([]);
  });
});

const BASE_MANIFEST = {
  name: 'app',
  scripts: { build: 'tsup' },
  dependencies: { yaml: '^2.8.0' },
  devDependencies: { vitest: '^3.1.0', eslint: '^9.30.0' },
};

/** A `package.json` change from `BASE_MANIFEST` to `head`. */
const manifest = (head: object): { manifestChanges: FileChange[] } => ({
  manifestChanges: [
    {
      path: 'package.json',
      baseText: JSON.stringify(BASE_MANIFEST),
      headText: JSON.stringify(head),
    },
  ],
});

const devBump = manifest({
  ...BASE_MANIFEST,
  devDependencies: { vitest: '^3.2.0', eslint: '^9.30.0' },
});
const runtimeBump = manifest({ ...BASE_MANIFEST, dependencies: { yaml: '^2.9.0' } });
const eslintBump = manifest({
  ...BASE_MANIFEST,
  devDependencies: { vitest: '^3.1.0', eslint: '^9.31.0' },
});

const pinBump: FileChange = {
  path: '.github/workflows/ci.yml',
  baseText:
    'on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - uses: actions/checkout@aaa # v4.1.0\n',
  headText:
    'on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - uses: actions/checkout@bbb # v4.2.0\n',
};

describe('decideTitle — chore changes nothing that ships', () => {
  it('passes a chore(deps) dev-dependency bump with its lockfile', () => {
    expect(
      findings('chore(deps): bump vitest', ['package.json', 'pnpm-lock.yaml'], devBump),
    ).toEqual([]);
  });

  it('passes a chore(deps) GitHub Actions bump', () => {
    const facts = { workflowChanges: [pinBump] };
    expect(findings('chore(deps): bump actions/checkout', [pinBump.path], facts)).toEqual([]);
  });

  it('passes a chore that touches docs, tests, metadata, and CI together', () => {
    expect(
      findings('chore: tidy repo', [
        'README.md',
        'test/a.test.ts',
        '.gitignore',
        '.github/dependabot.yml',
      ]),
    ).toEqual([]);
  });

  it('blocks a chore that touches source, naming only the offending path', () => {
    const [finding] = findings('chore: tidy', ['README.md', 'src/index.ts']);
    expect(finding?.effect).toBe('block');
    expect(finding?.message).toContain('`src/index.ts`');
    expect(finding?.message).not.toContain('`README.md`');
    expect(finding?.message).toContain('Retitle');
  });

  it('blocks a chore(deps) that bumps a runtime dependency', () => {
    const [finding] = findings(
      'chore(deps): bump yaml',
      ['package.json', 'pnpm-lock.yaml'],
      runtimeBump,
    );
    expect(finding?.message).toContain('`package.json`');
  });

  it('blocks a chore whose manifest change reaches past the dependency blocks', () => {
    const scripts = manifest({ ...BASE_MANIFEST, scripts: { build: 'tsc' } });
    expect(findings('chore: switch build', ['package.json'], scripts)[0]?.message).toContain(
      '`package.json`',
    );
  });

  it('blocks a chore that edits linter config, which is a ci change', () => {
    expect(findings('chore: relax lint', ['eslint.config.mjs'])[0]?.message).toContain(
      '`eslint.config.mjs`',
    );
  });

  it('blocks a chore that edits a shipped reusable workflow', () => {
    const shipped: FileChange = {
      path: '.github/workflows/release.yml',
      baseText: 'on: workflow_call\njobs: {}\n',
      headText: 'on: workflow_call\njobs: { a: {} }\n',
    };
    const [finding] = findings('chore: tweak release', [shipped.path], {
      workflowChanges: [shipped],
    });
    expect(finding?.message).toContain('`.github/workflows/release.yml`');
  });

  it('counts a rename out of source into an allowed path as a source change', () => {
    // pull-request.ts records a rename's old path alongside the new one.
    const [finding] = findings('chore: move notes', ['src/notes.ts', 'docs/notes.ts']);
    expect(finding?.message).toContain('`src/notes.ts`');
  });

  it('leaves a release-please release PR alone', () => {
    expect(findings('chore(main): release 1.2.0', ['package.json', 'CHANGELOG.md'])).toEqual([]);
  });
});

describe('decideTitle — ci changes only CI and tooling', () => {
  it('passes a ci PR that touches only workflows', () => {
    expect(
      findings('ci: cache pnpm', ['.github/workflows/ci.yml', '.github/workflows/lint.yml']),
    ).toEqual([]);
  });

  it('passes a ci PR that changes lint, format, and test-runner config with docs', () => {
    expect(
      findings('ci: tighten lint', [
        'eslint.config.mjs',
        '.prettierrc.json',
        'vitest.config.ts',
        'ruff.toml',
        '.repo-hygiene.yml',
        'AGENTS.md',
      ]),
    ).toEqual([]);
  });

  it('passes a ci(deps) sensitive-tool bump, as the sensitive-bump rule asks', () => {
    expect(
      findings('ci(deps): bump eslint', ['package.json', 'pnpm-lock.yaml'], eslintBump),
    ).toEqual([]);
  });

  it('passes a ci(deps) sensitive-tool bump declared under dependencies', () => {
    const base = { name: 'config', dependencies: { prettier: '^3.5.0' } };
    const facts = {
      manifestChanges: [
        {
          path: 'package.json',
          baseText: JSON.stringify(base),
          headText: JSON.stringify({ ...base, dependencies: { prettier: '^3.6.0' } }),
        },
      ],
    };
    expect(findings('ci(deps): bump prettier', ['package.json'], facts)).toEqual([]);
  });

  it('passes a ci(deps) sensitive-tool bump in a requirements file', () => {
    const facts = {
      manifestChanges: [
        { path: 'requirements.txt', baseText: 'ruff==0.5.0\n', headText: 'ruff==0.6.0\n' },
      ],
    };
    expect(findings('ci(deps): bump ruff', ['requirements.txt'], facts)).toEqual([]);
  });

  it('blocks a ci PR that touches source, naming only the offending path', () => {
    const [finding] = findings('ci: wire up check', ['.github/workflows/ci.yml', 'src/check.ts']);
    expect(finding?.effect).toBe('block');
    expect(finding?.message).toContain('`src/check.ts`');
    expect(finding?.message).not.toContain('`.github/workflows/ci.yml`');
  });

  it('blocks a ci PR that changes a test', () => {
    expect(findings('ci: fix flaky job', ['test/a.test.ts'])[0]?.message).toContain(
      '`test/a.test.ts`',
    );
  });

  it('blocks a ci(deps) bump of a runtime dependency', () => {
    expect(findings('ci(deps): bump yaml', ['package.json'], runtimeBump)[0]?.message).toContain(
      '`package.json`',
    );
  });

  it('blocks a ci PR that changes build config', () => {
    expect(findings('ci: target es2023', ['tsconfig.json'])[0]?.message).toContain(
      '`tsconfig.json`',
    );
  });

  it('counts a rename out of source into CI as a source change', () => {
    const [finding] = findings('ci: move script', ['src/release.ts', '.github/scripts/release.ts']);
    expect(finding?.message).toContain('`src/release.ts`');
  });
});
