/**
 * The one definition of a test file, shared by every check that sorts paths:
 * the UAT gate's `tests` exemption and the title check's `test`/`refactor`
 * rules. Keep them reading the same list, so a path is never a test to one
 * check and code to another.
 */

const TEST_DIRS = new Set(['test', 'tests', '__tests__', '__snapshots__', '__mocks__', 'e2e']);
// Storybook stories are tests: the Storybook test runner gates on them, and a
// story never ships in the app, so a story-only change has nothing to release
// and nothing to user-test.
const TEST_FILE =
  /\.(test|spec)\.[cm]?[jt]sx?$|\.stories\.([cm]?[jt]sx?|mdx)$|^test_.*\.py$|_test\.(py|go)$|^conftest\.py$/;

/** Whether a changed path is a test, fixture, snapshot, mock, or Storybook story. */
export function isTestPath(path: string): boolean {
  const parts = path.split('/');
  const name = parts.at(-1) ?? '';
  return parts.slice(0, -1).some((dir) => TEST_DIRS.has(dir)) || TEST_FILE.test(name);
}
