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

  it('passes --strict added to an existing command', () => {
    expect(strengtheningFor(testRuns('pnpm test --strict'))).toEqual(['strict-enabled']);
  });

  it('holds a first bound added, since the value in force before is unknown', () => {
    // flake8's default, or a setup.cfg, may be stricter than the new flag.
    expect(judge(BASE_WORKFLOW, testRuns('pnpm test --max-warnings 0')).holds).toEqual([
      'check-changed',
    ]);
    const base = testRuns('pnpm eslint . --max-warnings 0');
    const duplicated = testRuns('pnpm eslint . --max-warnings 0 --max-warnings 999');
    // The later duplicate wins, so the bound in force rose.
    expect(judge(base, duplicated).holds).toEqual(['threshold-loosened', 'check-changed']);
  });

  it('reads a bound made negative, which some tools read as no limit, as loosened', () => {
    const base = testRuns('pnpm eslint . --max-warnings 0');
    expect(judge(base, testRuns('pnpm eslint . --max-warnings -1')).holds).toEqual([
      'threshold-loosened',
    ]);
  });

  it('reads a removed bound or strict flag as a loosening', () => {
    const base = testRuns('pnpm eslint . --max-warnings 0 --strict');
    expect(judge(base, testRuns('pnpm eslint . --strict')).holds).toEqual(['threshold-loosened']);
    expect(judge(base, testRuns('pnpm eslint . --max-warnings 0')).holds).toEqual([
      'strict-disabled',
    ]);
  });

  it('keeps a loosening visible beside an unknown edit to the same command', () => {
    const base = testRuns('pnpm eslint src --max-warnings 0');
    expect(judge(base, testRuns('pnpm eslint lib')).holds).toEqual([
      'threshold-loosened',
      'check-changed',
    ]);
    const raised = judge(base, testRuns('pnpm eslint src --max-warnings 9 --quiet'));
    expect(raised.holds).toEqual(['threshold-loosened', 'check-changed']);
  });

  it('reads a raised cap as a loosening', () => {
    const base = testRuns('pnpm eslint . --max-warnings=5');
    expect(judge(base, testRuns('pnpm eslint . --max-warnings=10')).holds).toEqual([
      'threshold-loosened',
    ]);
  });

  it('reads a lowered coverage floor as a loosening', () => {
    const base = testRuns('pytest --cov-fail-under 90');
    expect(judge(base, testRuns('pytest --cov-fail-under 80')).holds).toEqual([
      'threshold-loosened',
    ]);
  });

  it('holds a bound outside the known vocabulary, whatever its direction', () => {
    // `--min-severity` raised reports *fewer* issues: name patterns aren't enough.
    const base = testRuns('scan --min-severity 2');
    expect(judge(base, testRuns('scan --min-severity 3')).holds).toEqual(['check-changed']);
  });

  it('holds a negated or valued strict flag', () => {
    for (const flag of ['--no-strict', '--non-strict', '--disable-strict']) {
      expect(judge(BASE_WORKFLOW, testRuns(`pnpm test ${flag}`)).holds).toEqual(['check-changed']);
    }
    expect(judge(BASE_WORKFLOW, testRuns('pnpm test --strict false')).holds).toEqual([
      'check-changed',
    ]);
  });

  it('passes a check appended with &&, since the base command still fails the step', () => {
    expect(judge(BASE_WORKFLOW, testRuns('pnpm test && pnpm lint'))).toEqual({
      verdict: 'tightening',
      holds: [],
      stricter: ['check-appended'],
    });
  });

  it('holds any append that can decide the status instead of the base command', () => {
    for (const command of [
      'pnpm test; pnpm lint',
      'pnpm test && pnpm lint; echo ok',
      'pnpm test && pnpm lint;echo ok',
      'pnpm test && pnpm lint &',
      'pnpm test && { pnpm lint; }',
    ]) {
      expect(judge(BASE_WORKFLOW, testRuns(command)).holds).toEqual(['check-changed']);
    }
  });

  it('holds an append followed by another line', () => {
    const head = edited(
      '        run: pnpm test',
      '        run: |\n          pnpm test && pnpm lint\n          echo done',
    );
    expect(judge(BASE_WORKFLOW, head).holds).toEqual(['check-changed']);
  });

  it('holds two lines joined into one, which changes what runs', () => {
    const lines = edited(
      '        run: pnpm test',
      '        run: |\n          pnpm vitest run\n          echo done',
    );
    const joined = testRuns('pnpm vitest run echo done');
    expect(judge(lines, joined).holds).toEqual(['check-changed']);
  });

  it('reads any new || as a swallowed failure, wherever it lands', () => {
    for (const command of [
      'pnpm test || pnpm retry',
      'pnpm test || /bin/true',
      'pnpm test && pnpm lint || pnpm other',
      'pnpm test && pnpm lint || true',
      'pnpm test && exit 0',
    ]) {
      expect(judge(BASE_WORKFLOW, testRuns(command)).holds).toEqual(['failure-ignored']);
    }
  });

  it('reads a newly swallowed failure as a loosening', () => {
    for (const command of [
      'pnpm test || true',
      '"pnpm test || :"',
      'set +e; pnpm test',
      'pnpm test; exit 0',
      'pnpm test || echo failed',
    ]) {
      expect(judge(BASE_WORKFLOW, testRuns(command)).holds).toEqual(['failure-ignored']);
    }
    const base = testRuns('pnpm test || true');
    expect(judge(base, testRuns('pnpm test --strict || true')).holds).toEqual([]);
  });

  it('reads a new step inserted before a same-keyed one as an addition', () => {
    const caches = (...keys: string[]) =>
      edited(
        '      - uses: actions/checkout@v4\n',
        `      - uses: actions/checkout@v4\n${keys.map((key) => `      - uses: actions/cache@v4\n        with:\n          key: ${key}\n`).join('')}`,
      );
    expect(judge(caches('deps'), caches('build', 'deps'))).toEqual({
      verdict: 'tightening',
      holds: [],
      stricter: [],
    });
  });

  it('reads a command step replaced by an unrelated one as a removal', () => {
    const lint = (command: string) =>
      edited(
        '      - uses: actions/checkout@v4\n',
        `      - uses: actions/checkout@v4\n      - run: ${command}\n`,
      );
    expect(judge(lint('pnpm lint'), lint('pnpm build')).holds).toEqual(['step-removed']);
  });

  it('judges every step that shares a key, not only the first', () => {
    const twice = (second: string) =>
      edited(
        '      - name: Test\n        run: pnpm test\n',
        `      - name: Test\n        run: pnpm test\n      - name: Test\n        run: ${second}\n`,
      );
    expect(judge(twice('pnpm e2e'), twice('pnpm e2e --quiet')).holds).toEqual(['check-changed']);
    expect(judge(twice('pnpm e2e'), twice('pnpm e2e || true')).holds).toEqual(['failure-ignored']);
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

  it('passes a newly added strict switch, but holds a new bound', () => {
    const base = testWith('config: ci.yml');
    expect(judge(base, testWith('config: ci.yml', 'fail_on_error: true')).stricter).toEqual([
      'strict-enabled',
    ]);
    // The action's own default for `max-lines` may be lower than 2000.
    expect(judge(base, testWith('config: ci.yml', 'max-lines: 2000')).holds).toEqual([
      'check-changed',
    ]);
    // A negated switch is no strict switch: it is an unknown input, which passes.
    expect(judge(base, testWith('config: ci.yml', 'disable-strict: true')).stricter).toEqual([]);
  });

  it('reads a raised cap, strict turned off, or either removed as a loosening', () => {
    const base = testWith('max-lines: 400', 'strict: true', 'paths: src');
    expect(judge(base, testWith('max-lines: 500', 'strict: true', 'paths: src')).holds).toEqual([
      'threshold-loosened',
    ]);
    expect(judge(base, testWith('max-lines: 400', 'strict: false', 'paths: src')).holds).toEqual([
      'strict-disabled',
    ]);
    expect(judge(base, testWith('strict: true', 'paths: src')).holds).toEqual([
      'threshold-loosened',
    ]);
    expect(judge(base, testWith('max-lines: 400', 'paths: src')).holds).toEqual([
      'strict-disabled',
    ]);
  });

  it('holds a removed or changed unknown input, and passes an added one', () => {
    const base = testWith('max-lines: 400', 'strict: true', 'paths: src');
    expect(judge(base, testWith('max-lines: 400', 'strict: true')).holds).toEqual([
      'check-changed',
    ]);
    expect(judge(base, testWith('max-lines: 400', 'strict: true', 'paths: lib')).holds).toEqual([
      'check-changed',
    ]);
    // Like any field an existing step gains (rmartz/pr-policy#134).
    const added = testWith('max-lines: 400', 'strict: true', 'paths: src', 'cache: pnpm');
    expect(judge(base, added)).toEqual({ verdict: 'tightening', holds: [], stricter: [] });
  });

  it('judges the inputs a job passes to a reusable workflow', () => {
    const caller = (cap: number) =>
      `${BASE_WORKFLOW}  hygiene:\n    uses: org/hygiene/.github/workflows/check.yml@v1\n    with:\n      max-lines: ${cap}\n`;
    expect(judge(caller(400), caller(300)).stricter).toEqual(['threshold-tightened']);
    expect(judge(caller(400), caller(500)).holds).toEqual(['threshold-loosened']);
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

  it("passes a first timeout at or under GitHub's default, and reads one above it as raised", () => {
    const deploy = (minutes: number) =>
      edited(
        '  deploy:\n    needs: [build]\n',
        `  deploy:\n    needs: [build]\n    timeout-minutes: ${minutes}\n`,
      );
    expect(strengtheningFor(deploy(30))).toEqual(['timeout-reduced']);
    expect(judge(BASE_WORKFLOW, deploy(400)).holds).toEqual(['timeout-raised']);
    expect(judge(BASE_WORKFLOW, deploy(360))).toEqual({
      verdict: 'tightening',
      holds: [],
      stricter: [],
    });
  });
});

describe('the backstop keeps a command step its identity', () => {
  /** A workflow whose `check` job runs `steps` (YAML step lines, already indented). */
  const workflow = (...steps: string[]) =>
    `on: pull_request\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n${steps.join('')}`;
  const step = (run: string, field = '') =>
    `      - run: ${run}\n${field ? `        ${field}\n` : ''}`;

  it('holds a changed if: hidden by a new step carrying the old one', () => {
    const base = workflow(step('pnpm test', `if: github.event_name != 'schedule'`));
    const head = workflow(
      step('pnpm test', 'if: false'),
      step('pnpm build', `if: github.event_name != 'schedule'`),
    );
    expect(judge(base, head).holds).toEqual(['unclassified-change']);
  });

  it('holds if: conditions swapped between two command steps', () => {
    const base = workflow(
      step('pnpm test', 'if: always()'),
      step('pnpm build', `if: github.event_name == 'push'`),
    );
    const head = workflow(
      step('pnpm test', `if: github.event_name == 'push'`),
      step('pnpm build', 'if: always()'),
    );
    expect(judge(base, head).holds).toEqual(['unclassified-change', 'unclassified-change']);
  });

  it('holds working-directory values swapped between two command steps', () => {
    const base = workflow(
      step('pnpm test', 'working-directory: app'),
      step('pnpm build', 'working-directory: docs'),
    );
    const head = workflow(
      step('pnpm test', 'working-directory: docs'),
      step('pnpm build', 'working-directory: app'),
    );
    expect(judge(base, head).holds).toEqual(['unclassified-change', 'unclassified-change']);
  });

  it('pairs `pnpm run` steps by their script, not by `run`', () => {
    const base = workflow(step('pnpm run test'));
    expect(judge(base, workflow(step('pnpm run build'))).holds).toEqual(['step-removed']);
    expect(judge(base, workflow(step('pnpm run test --strict'))).stricter).toEqual([
      'strict-enabled',
    ]);
  });
});

describe('bound names', () => {
  it('holds a lowered bound whose name only ends in a known one', () => {
    const base = testRuns('scanner --scan-max-lines 5000');
    expect(judge(base, testRuns('scanner --scan-max-lines 10')).holds).toEqual(['check-changed']);
  });
});

describe('round-5 regressions', () => {
  const workflow = (...steps: string[]) =>
    `on: pull_request\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n${steps.join('')}`;

  it('holds a step whose context changed while a decoy copy carries the old one', () => {
    const lint = (on: string, failOnError: boolean) =>
      `      - uses: some/lint@v1\n        if: github.event_name == '${on}'\n        with:\n          fail-on-error: ${failOnError}\n`;
    const base = workflow(lint('pull_request', true));
    const head = workflow(lint('push', true), lint('pull_request', false));
    expect(judge(base, head).holds).toContain('unclassified-change');

    const run = (on: string, cap: number) =>
      `      - run: pnpm lint --max-warnings ${cap}\n        if: github.event_name == '${on}'\n`;
    const decoy = judge(
      workflow(run('pull_request', 5)),
      workflow(run('push', 3), run('pull_request', 999)),
    );
    expect(decoy.verdict).toBe('loosening');
  });

  it('pairs an unnamed command by its executable, not by a flag value', () => {
    const step = (command: string) => workflow(`      - run: ${command}\n`);
    expect(judge(step('eslint --max-warnings 5 .'), step('eslint --max-warnings 0 .'))).toEqual({
      verdict: 'tightening',
      holds: [],
      stricter: ['threshold-tightened'],
    });
    expect(
      judge(step('pytest --cov-fail-under 80 tests'), step('pytest --cov-fail-under 90 tests'))
        .stricter,
    ).toEqual(['threshold-tightened']);
  });

  it('reads every form of turning errexit off as a swallowed failure', () => {
    for (const command of ['set +eu; pnpm test', 'set +o errexit; pnpm test']) {
      expect(judge(BASE_WORKFLOW, testRuns(command)).holds).toEqual(['failure-ignored']);
    }
  });

  it('does not read `|| exit 1` or `|| false` as swallowing a failure', () => {
    for (const command of ['pnpm test || exit 1', 'pnpm test || false']) {
      expect(judge(BASE_WORKFLOW, testRuns(command)).holds).toEqual(['check-changed']);
    }
  });

  it("reads a reusable workflow's input default with the vocabulary", () => {
    const callable = (strict: boolean, cap: number) =>
      `on:\n  workflow_call:\n    inputs:\n      strict:\n        type: boolean\n        default: ${strict}\n      max-warnings:\n        type: number\n        default: ${cap}\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ./lint.sh\n`;
    expect(judge(callable(true, 0), callable(false, 0)).holds).toEqual(['strict-disabled']);
    expect(judge(callable(true, 0), callable(true, 10)).holds).toEqual(['threshold-loosened']);
  });
});

describe('round-6 regressions on a shipped workflow', () => {
  const shipped = (command: string) =>
    `on: workflow_call\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Lint\n        run: ${command}\n`;

  it('holds a known loosening that follows an edit it cannot classify', () => {
    expect(
      judge(shipped('eslint src --max-warnings 0'), shipped('eslint lib --max-warnings 50')).holds,
    ).toEqual(['threshold-loosened']);
    expect(
      judge(
        shipped('pnpm lint --format a --max-warnings 0'),
        shipped('pnpm lint --format b --max-warnings 100'),
      ).holds,
    ).toEqual(['threshold-loosened']);
    expect(judge(shipped('pnpm lint src --strict'), shipped('pnpm lint lib')).holds).toEqual([
      'strict-disabled',
    ]);
  });

  it('holds an exit 0 added in any position', () => {
    const head = shipped('|\n          if [ -n "$SKIP" ]; then exit 0; fi\n          ./lint.sh');
    expect(judge(shipped('./lint.sh'), head).holds).toEqual(['failure-ignored']);
  });
});

describe('round-7 fixes on a shipped workflow', () => {
  const shipped = (command: string) =>
    `on: workflow_call\njobs:\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Lint\n        run: ${command}\n`;

  it('keeps a removed bound the walk found before an edit it cannot classify', () => {
    const base = shipped(
      '|\n          eslint a --max-warnings 0\n          eslint b --max-warnings 0',
    );
    const head = shipped('|\n          eslint a\n          eslint b --max-warnings 0 --fix');
    expect(judge(base, head).holds).toEqual(['threshold-loosened']);
  });

  it('holds a new || even when an exit 0 was dropped in the same edit', () => {
    const base = shipped('|\n          if [ -z "$X" ]; then exit 0; fi\n          pnpm test');
    expect(judge(base, shipped('pnpm test || echo failed')).holds).toEqual(['failure-ignored']);
  });
});
