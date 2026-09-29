import { describe, expect, it } from 'vitest';
import { isTestPath } from '../../src/checks/test-paths.js';

describe('isTestPath', () => {
  it.each([
    'test/fixtures/workflow.yml',
    'tests/test_foo.py',
    'src/__tests__/a.ts',
    'src/__snapshots__/a.test.ts.snap',
    'src/__mocks__/fs.ts',
    'e2e/login.ts',
    'src/a.test.ts',
    'src/a.spec.tsx',
    'src/a.test.mjs',
    'pkg/test_util.py',
    'pkg/util_test.py',
    'pkg/conftest.py',
    'cmd/main_test.go',
  ])('recognises %s', (path) => {
    expect(isTestPath(path)).toBe(true);
  });

  it.each([
    'src/testing.ts',
    'src/contest/a.ts',
    'docs/test.md',
    'src/latest.ts',
    'attest.py',
    'vitest.config.ts',
  ])('does not flag %s', (path) => {
    expect(isTestPath(path)).toBe(false);
  });
});
