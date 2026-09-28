import { describe, expect, it } from 'vitest';
import { decideTitle } from '../../../src/checks/title/index.js';
import type { FileChange, PullRequestFacts } from '../../../src/policy.js';

const WORKFLOW = '.github/workflows/ci.yml';
const BASE_WORKFLOW = `on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@aaaa # v1.0.0
      - run: pnpm test
`;

function pr(title: string, overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
  return {
    title,
    labels: [],
    changedFiles: [],
    workflowChanges: [],
    manifestChanges: [],
    signOffs: [],
    ...overrides,
  };
}

const messages = (facts: PullRequestFacts) =>
  decideTitle(facts).findings.map((finding) => finding.message);

const workflowEdit = (headText: string): FileChange[] => [
  { path: WORKFLOW, baseText: BASE_WORKFLOW, headText },
];

const pkg = (prettier: string): string =>
  JSON.stringify({ devDependencies: { prettier, typescript: '^6.0.3' } });

describe('decideTitle — grammar', () => {
  it('passes a plain conventional title', () => {
    expect(messages(pr('feat(cli): add --json'))).toEqual([]);
  });

  it.each(['Add a feature', 'feature: add x', 'feat:no space', '[WIP] feat: x', 'feat!(cli): x'])(
    'blocks a non-conventional title: %s',
    (title) => {
      expect(messages(pr(title))[0]).toContain('is not a Conventional Commit');
    },
  );

  it('reports every finding as blocking — a title is always fixable by the author', () => {
    const effects = decideTitle(pr('Bad title')).findings.map((finding) => finding.effect);
    expect(effects).toEqual(['block']);
  });
});

describe('decideTitle — breaking markers', () => {
  it('blocks `!` on a non-functional type', () => {
    expect(messages(pr('chore!: drop node 18', { labels: [] }))[0]).toContain('Drop the `!`');
  });

  it('blocks a `breaking change` label on a non-functional type', () => {
    expect(messages(pr('ci: tweak', { labels: ['breaking change'] }))[0]).toContain(
      'Remove the label',
    );
  });

  it('blocks a breaking label without `!`, and says the exact retitle', () => {
    expect(messages(pr('feat(api): drop v1', { labels: ['Breaking Change'] }))[0]).toContain(
      '`feat(api)!: drop v1`',
    );
  });

  it('treats `hotfix` as breaking intent on a functional type', () => {
    expect(messages(pr('fix: patch prod', { labels: ['hotfix'] }))[0]).toContain('no `!`');
  });

  it('blocks `!` without the label', () => {
    expect(messages(pr('feat!: drop v1'))[0]).toContain('lacks the `breaking change` label');
  });

  it('passes a functional `!` title that carries the label', () => {
    expect(messages(pr('feat!: drop v1', { labels: ['breaking change'] }))).toEqual([]);
  });
});

describe('decideTitle — own-CI changes recommend ci', () => {
  const substantive = workflowEdit(BASE_WORKFLOW.replace('      - run: pnpm test\n', ''));
  const effects = (facts: PullRequestFacts) =>
    decideTitle(facts).findings.map((finding) => finding.effect);

  it('notes, without blocking, a substantive own-CI change on a non-releasing type', () => {
    const facts = pr('chore: tidy ci', { workflowChanges: substantive });
    expect(messages(facts)[0]).toContain('consider titling it `ci(<scope>): …`');
    expect(effects(facts)).toEqual(['info']);
  });

  it('passes the same change typed `ci`', () => {
    expect(messages(pr('ci: tidy', { workflowChanges: substantive }))).toEqual([]);
  });

  it.each(['feat: add a test layer', 'fix: repair the build', 'perf: cache deps'])(
    'never tells a release type to retitle, and needs no breaking label: %s',
    (title) => {
      expect(messages(pr(title, { workflowChanges: substantive }))).toEqual([]);
    },
  );

  it('exempts a pure action-pin bump, which keeps its Dependabot `chore` type', () => {
    const bump = workflowEdit(
      BASE_WORKFLOW.replace('checkout@aaaa # v1.0.0', 'checkout@bbbb # v1.1.0'),
    );
    expect(messages(pr('chore(deps): bump actions/checkout', { workflowChanges: bump }))).toEqual(
      [],
    );
  });

  it('counts an added workflow file as a CI change', () => {
    const added: FileChange[] = [{ path: WORKFLOW, headText: BASE_WORKFLOW }];
    expect(messages(pr('docs: add ci', { workflowChanges: added }))[0]).toContain('`ci(<scope>)');
  });
});

describe('decideTitle — shipped reusable workflows are product code', () => {
  const REUSABLE = `on:
  workflow_call:
    inputs:
      node-version:
        type: string
jobs:
  screenshots:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm screenshots
`;
  const reusableEdit = (headText: string, baseText: string = REUSABLE): FileChange[] => [
    { path: '.github/workflows/screenshots.yml', baseText, headText },
  ];
  const changed = reusableEdit(REUSABLE.replace('pnpm screenshots', 'pnpm screenshots --ci'));

  it.each(['perf(screenshots): parallelize', 'feat: add an input', 'chore: tidy'])(
    'raises nothing for a workflow_call-only workflow: %s',
    (title) => {
      expect(messages(pr(title, { workflowChanges: changed }))).toEqual([]);
    },
  );

  it.each([
    ['a list', 'on: [workflow_call]'],
    ['a scalar', 'on: workflow_call'],
  ])('recognizes `on:` written as %s', (_form, on) => {
    const head = REUSABLE.replace(/^on:\n {2}workflow_call:\n(?: {4,}.*\n)*/, `${on}\n`);
    expect(messages(pr('chore: tidy', { workflowChanges: reusableEdit(head) }))).toEqual([]);
  });

  it('treats a deleted workflow_call-only workflow as product code', () => {
    const deleted: FileChange[] = [
      { path: '.github/workflows/screenshots.yml', baseText: REUSABLE },
    ];
    expect(
      messages(
        pr('feat!: drop screenshots', { labels: ['breaking change'], workflowChanges: deleted }),
      ),
    ).toEqual([]);
  });

  it('counts a workflow that also runs on this repo as own CI', () => {
    const head = REUSABLE.replace('on:\n', 'on:\n  push:\n');
    expect(messages(pr('chore: tidy', { workflowChanges: reusableEdit(head) }))[0]).toContain(
      'consider titling',
    );
  });
});

describe('decideTitle — CI-sensitive tool bumps', () => {
  const bump: FileChange[] = [
    { path: 'package.json', baseText: pkg('^3.9.8'), headText: pkg('^3.10.0') },
  ];

  it('blocks a formatter bump that is not ci-typed', () => {
    expect(messages(pr('chore(deps-dev): bump prettier', { manifestChanges: bump }))[0]).toContain(
      '`prettier`',
    );
  });

  it('passes the same bump typed `ci(deps)`', () => {
    expect(messages(pr('ci(deps): bump prettier', { manifestChanges: bump }))).toEqual([]);
  });

  it('never tells a release-typed bump to retitle to `ci`', () => {
    expect(messages(pr('fix(deps): bump prettier', { manifestChanges: bump }))).toEqual([]);
  });
});

describe('decideTitle — release-please', () => {
  it.each([
    [pr('chore(main): release 1.2.0')],
    [pr('whatever', { labels: ['autorelease: pending'] })],
  ])('exempts a release-please release PR', (facts) => {
    expect(messages(facts)).toEqual([]);
  });
});
