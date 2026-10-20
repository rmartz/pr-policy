import { describe, expect, it } from 'vitest';
import { pathKind, type PathContext } from '../../src/checks/path-kinds.js';
import type { FileChange } from '../../src/policy.js';

const none: PathContext = { workflowChanges: [], manifestChanges: [] };

const withManifest = (change: FileChange): PathContext => ({
  workflowChanges: [],
  manifestChanges: [change],
});

const packageJson = (base: object, head: object): PathContext =>
  withManifest({
    path: 'package.json',
    baseText: JSON.stringify(base),
    headText: JSON.stringify(head),
  });

describe('pathKind — by path', () => {
  it.each([
    ['docs/guide.svg', 'docs'],
    ['src/AGENTS.md', 'docs'],
    ['src/a.test.ts', 'tests'],
    ['.github/workflows/ci.yml', 'ci'],
    ['.github/dependabot.yml', 'metadata'],
    ['LICENSE', 'metadata'],
    ['packages/web/pnpm-lock.yaml', 'lockfile'],
    ['eslint.config.mjs', 'tooling-config'],
    ['packages/web/vitest.config.ts', 'tooling-config'],
    ['.pre-commit-config.yaml', 'tooling-config'],
  ])('reads %s as %s', (path, kind) => {
    expect(pathKind(path, none)).toBe(kind);
  });

  it.each(['src/index.ts', 'tsconfig.json', 'next.config.ts', 'scripts/build.mjs', 'action.yml'])(
    'reads %s as possible product code',
    (path) => {
      expect(pathKind(path, none)).toBeUndefined();
    },
  );
});

describe('pathKind — package.json scope', () => {
  const base = {
    name: 'x',
    dependencies: { yaml: '^2.8.0' },
    devDependencies: { vitest: '^3.1.0' },
  };

  it('reads a dev-dependency and packageManager change as tooling', () => {
    const head = { ...base, devDependencies: { vitest: '^3.2.0' }, packageManager: 'pnpm@10.1.0' };
    expect(pathKind('package.json', packageJson(base, head))).toBe('tooling-manifest');
  });

  it('reads a CI-sensitive tool under dependencies as tooling', () => {
    const before = { ...base, dependencies: { ...base.dependencies, eslint: '^9.30.0' } };
    const after = { ...base, dependencies: { ...base.dependencies, eslint: '^9.31.0' } };
    expect(pathKind('package.json', packageJson(before, after))).toBe('tooling-manifest');
  });

  it('reads a runtime dependency change as runtime', () => {
    const head = { ...base, dependencies: { yaml: '^2.9.0' } };
    expect(pathKind('package.json', packageJson(base, head))).toBe('runtime-manifest');
  });

  it('reads an added peer dependency as runtime', () => {
    const head = { ...base, peerDependencies: { react: '^19.0.0' } };
    expect(pathKind('package.json', packageJson(base, head))).toBe('runtime-manifest');
  });

  it('reads a change outside the dependency blocks as possible product code', () => {
    const head = { ...base, exports: './dist/index.js' };
    expect(pathKind('package.json', packageJson(base, head))).toBeUndefined();
  });

  it('reads a manifest it never saw as possible product code', () => {
    expect(pathKind('package.json', none)).toBeUndefined();
  });
});

describe('pathKind — requirements scope', () => {
  it('reads a dev requirements file as tooling', () => {
    const change = {
      path: 'requirements-dev.txt',
      baseText: 'pytest==8.0\n',
      headText: 'pytest==8.1\n',
    };
    expect(pathKind(change.path, withManifest(change))).toBe('tooling-manifest');
  });

  it('reads a runtime pin as runtime', () => {
    const change = { path: 'requirements.txt', baseText: 'flask==3.0\n', headText: 'flask==3.1\n' };
    expect(pathKind(change.path, withManifest(change))).toBe('runtime-manifest');
  });

  it('reads a requirements file it never saw as runtime', () => {
    expect(pathKind('requirements.txt', none)).toBe('runtime-manifest');
  });
});
