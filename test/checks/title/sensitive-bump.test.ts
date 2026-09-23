import { describe, expect, it } from 'vitest';
import { isManifestPath, sensitiveBumps } from '../../../src/checks/title/sensitive-bump.js';

describe('isManifestPath', () => {
  it.each([
    ['package.json', true],
    ['packages/cli/package.json', true],
    ['requirements.txt', true],
    ['requirements-dev.txt', true],
    ['node_modules/x/package.json', false],
    ['package-lock.json', false],
    ['src/requirements.ts', false],
  ])('%s → %s', (path, expected) => {
    expect(isManifestPath(path)).toBe(expected);
  });
});

describe('sensitiveBumps', () => {
  const npm = (deps: Record<string, string>) => JSON.stringify({ devDependencies: deps });

  it('finds any version change to a sensitive npm package, not only a major', () => {
    const change = {
      path: 'package.json',
      baseText: npm({ eslint: '^10.11.0', vite: '^8.3.0' }),
      headText: npm({ eslint: '^10.11.1', vite: '^8.4.0' }),
    };
    expect(sensitiveBumps([change])).toEqual(['eslint']);
  });

  it('ignores a scoped package that merely contains a sensitive name', () => {
    const change = {
      path: 'package.json',
      baseText: npm({ '@typescript-eslint/parser': '^8.70.0' }),
      headText: npm({ '@typescript-eslint/parser': '^8.71.0' }),
    };
    expect(sensitiveBumps([change])).toEqual([]);
  });

  it('reads pip requirements, normalizing names', () => {
    const change = {
      path: 'requirements-dev.txt',
      baseText: 'Black==24.1.0\nruff==0.5.0  # linter\n',
      headText: 'Black==24.2.0\nruff==0.5.0  # linter\n',
    };
    expect(sensitiveBumps([change])).toEqual(['black']);
  });

  it('does not count a package that was only added', () => {
    const change = {
      path: 'package.json',
      baseText: npm({}),
      headText: npm({ prettier: '^3.0.0' }),
    };
    expect(sensitiveBumps([change])).toEqual([]);
  });
});
