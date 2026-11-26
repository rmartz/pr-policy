import { describe, expect, it } from 'vitest';
import { classifyWorkflowChanges } from '../../../src/checks/ci-change/classify.js';
import { BASE_WORKFLOW, WORKFLOW_PATH, edited, strengtheningFor } from './fixtures/workflow.js';

/** The holding and the strictly-stricter indicator kinds between two documents. */
function judge(baseText: string, headText: string) {
  const result = classifyWorkflowChanges([{ path: WORKFLOW_PATH, baseText, headText }]);
  return {
    verdict: result.verdict,
    holds: result.indicators.map((indicator) => indicator.kind),
    stricter: (result.strengthening ?? []).map((indicator) => indicator.kind),
  };
}

/** {@link BASE_WORKFLOW} with the Test step running `command`. */
const testRuns = (command: string) => edited('        run: pnpm test', `        run: ${command}`);

/** {@link BASE_WORKFLOW} with the Test step taking `inputs` (YAML lines under `with:`). */
const testWith = (...inputs: string[]) =>
  edited(
    '      - name: Test\n        run: pnpm test\n',
    `      - name: Test\n        uses: org/test@v1\n        with:\n${inputs.map((line) => `          ${line}\n`).join('')}`,
  );

describe('stricter commands', () => {
  it('passes a lowered max-warnings bound', () => {
    const base = testRuns('pnpm eslint . --max-warnings 5');
    expect(judge(base, testRuns('pnpm eslint . --max-warnings 0'))).toEqual({
      verdict: 'tightening',
      holds: [],
      stricter: ['threshold-tightened'],
    });
  });

  it('passes a bound in --flag=value form and a camelCase one', () => {
    const base = testRuns('pytest --cov-fail-under=80 --maxWarnings=3');
    const head = testRuns('pytest --cov-fail-under=90 --maxWarnings=1');
    expect(judge(base, head).stricter).toEqual(['threshold-tightened', 'threshold-tightened']);
  });

  it('passes a first bound or --strict added to an existing command', () => {
    expect(strengtheningFor(testRuns('pnpm test --max-warnings 0'))).toEqual([
      'threshold-tightened',
    ]);
    expect(strengtheningFor(testRuns('pnpm test --strict'))).toEqual(['strict-enabled']);
  });

  it('holds a raised bound', () => {
    const base = testRuns('pnpm eslint . --max-warnings=5');
    expect(judge(base, testRuns('pnpm eslint . --max-warnings=10')).holds).toEqual([
      'check-changed',
    ]);
  });

  it('holds a lowered coverage floor', () => {
    const base = testRuns('pytest --cov-fail-under 90');
    expect(judge(base, testRuns('pytest --cov-fail-under 80')).holds).toEqual(['check-changed']);
  });

  it('holds a bound outside the known vocabulary, whatever its direction', () => {
    // `--min-severity` raised reports *fewer* issues: name patterns aren't enough.
    const base = testRuns('scan --min-severity 2');
    expect(judge(base, testRuns('scan --min-severity 3')).holds).toEqual(['check-changed']);
  });

  it('holds a negated or valued strict flag', () => {
    expect(judge(BASE_WORKFLOW, testRuns('pnpm test --no-strict')).holds).toEqual([
      'check-changed',
    ]);
    expect(judge(BASE_WORKFLOW, testRuns('pnpm test --strict false')).holds).toEqual([
      'check-changed',
    ]);
  });

  it('holds an appended command or a swallowed failure, which a diff cannot tell apart', () => {
    expect(judge(BASE_WORKFLOW, testRuns('pnpm test && pnpm lint')).holds).toEqual([
      'check-changed',
    ]);
    expect(judge(BASE_WORKFLOW, testRuns('pnpm test || true')).holds).toEqual(['check-changed']);
  });

  it('holds a stricter bound bundled with any other edit to the same command', () => {
    const base = testRuns('pnpm eslint src --max-warnings 5');
    expect(judge(base, testRuns('pnpm eslint lib --max-warnings 0')).holds).toEqual([
      'check-changed',
    ]);
  });

  it('pairs a step known only by its command rather than reading it as removed', () => {
    const lint = (command: string) =>
      edited(
        '      - uses: actions/checkout@v4\n',
        `      - uses: actions/checkout@v4\n      - run: ${command}\n`,
      );
    expect(judge(lint('pnpm lint --max-warnings 5'), lint('pnpm lint --max-warnings 0'))).toEqual({
      verdict: 'tightening',
      holds: [],
      stricter: ['threshold-tightened'],
    });
    expect(judge(lint('pnpm lint'), lint('pnpm lint --quiet')).holds).toEqual(['check-changed']);
  });
});

describe('stricter inputs', () => {
  it('passes a lowered cap, a raised floor, and strict turned on', () => {
    const base = testWith('max-lines: 400', 'min-coverage: 80', 'strict: false');
    const head = testWith('max-lines: 300', 'min-coverage: 90', 'strict: true');
    expect(judge(base, head)).toEqual({
      verdict: 'tightening',
      holds: [],
      stricter: ['threshold-tightened', 'threshold-tightened', 'strict-enabled'],
    });
  });

  it('passes a newly added known bound or strict switch', () => {
    const base = testWith('config: ci.yml');
    const head = testWith('config: ci.yml', 'max-warnings: 0', 'fail_on_error: true');
    expect(judge(base, head).stricter).toEqual(['threshold-tightened', 'strict-enabled']);
  });

  it('holds a raised cap, strict turned off, a removed input, and an unknown new input', () => {
    const base = testWith('max-lines: 400', 'strict: true', 'paths: src');
    expect(judge(base, testWith('max-lines: 500', 'strict: true', 'paths: src')).holds).toEqual([
      'check-changed',
    ]);
    expect(judge(base, testWith('max-lines: 400', 'strict: false', 'paths: src')).holds).toEqual([
      'check-changed',
    ]);
    expect(judge(base, testWith('max-lines: 400', 'strict: true')).holds).toEqual([
      'check-changed',
    ]);
    const added = testWith('max-lines: 400', 'strict: true', 'paths: src', 'config: other.yml');
    expect(judge(base, added).holds).toEqual(['check-changed']);
  });

  it('judges the inputs a job passes to a reusable workflow', () => {
    const caller = (cap: number) =>
      `${BASE_WORKFLOW}  hygiene:\n    uses: org/hygiene/.github/workflows/check.yml@v1\n    with:\n      max-lines: ${cap}\n`;
    expect(judge(caller(400), caller(300)).stricter).toEqual(['threshold-tightened']);
    expect(judge(caller(400), caller(500)).holds).toEqual(['check-changed']);
  });
});

describe('stricter timeouts', () => {
  it('passes a lowered timeout', () => {
    const head = edited('    timeout-minutes: 5', '    timeout-minutes: 3');
    expect(judge(BASE_WORKFLOW, head)).toEqual({
      verdict: 'tightening',
      holds: [],
      stricter: ['timeout-reduced'],
    });
  });

  it("passes a first timeout at or under GitHub's default, and holds one above it", () => {
    const deploy = (minutes: number) =>
      edited(
        '  deploy:\n    needs: [build]\n',
        `  deploy:\n    needs: [build]\n    timeout-minutes: ${minutes}\n`,
      );
    expect(strengtheningFor(deploy(30))).toEqual(['timeout-reduced']);
    expect(judge(BASE_WORKFLOW, deploy(400)).holds).toEqual(['timeout-changed']);
  });
});
