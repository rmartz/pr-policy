import { beforeEach, describe, expect, it, vi } from 'vitest';
import { github, pages, transports } from './fake-github.js';

// GitHub is a boundary: both transports read the same raw API responses from the
// fake, so each case runs once through `gh` and once through `fetch`.
vi.mock('../../src/lib/github.js', async () => {
  const fake = await import('./fake-github.js');
  return { ghCall: fake.fakeGhCall, ...fake.fakeLabels };
});

const { applyLabelEdits, gatherFacts, openPullRequestsAtHead } =
  await import('../../src/github/pull-request.js');

const PR = {
  title: 'ci: tweak',
  body: null,
  draft: true,
  user: { login: 'dependabot[bot]', type: 'Bot' },
  head: { sha: 'head1' },
  base: { ref: 'main', repo: { default_branch: 'main' } },
  labels: [{ name: 'DevOps' }],
};

function labeled(name: string, login: string, at: string) {
  return { event: 'labeled', label: { name }, actor: { login, type: 'User' }, created_at: at };
}

beforeEach(() => {
  github.reset();
  github.responses.set('repos/o/r/pulls/7', PR);
  github.responses.set('repos/o/r/commits/head1/statuses', []);
  github.responses.set('repos/o/r/compare/main...head1', { merge_base_commit: { sha: 'base1' } });
});

describe.each(await transports())('gatherFacts over %s', (_name, makeClient) => {
  const target = () => ({ repo: 'o/r', pr: 7, client: makeClient() });

  it('reads workflow files at the merge base and the head', async () => {
    github.responses.set('repos/o/r/pulls/7/files', [
      { filename: '.github/workflows/ci.yml', status: 'modified' },
      { filename: 'src/a.ts', status: 'modified' },
    ]);
    github.responses.set('repos/o/r/contents/.github/workflows/ci.yml?ref=base1', 'on: push\n');
    github.responses.set('repos/o/r/contents/.github/workflows/ci.yml?ref=head1', 'on: [push]\n');
    const { facts, headSha } = await gatherFacts(target());
    expect(headSha).toBe('head1');
    expect(facts.labels).toEqual(['DevOps']);
    expect(facts.author).toEqual({ login: 'dependabot[bot]', type: 'Bot' });
    expect(facts.body).toBe(''); // a null description reads as empty, never absent
    expect(facts.draft).toBe(true);
    expect(facts.changedFiles).toEqual(['.github/workflows/ci.yml', 'src/a.ts']);
    expect(facts.workflowChanges).toEqual([
      { path: '.github/workflows/ci.yml', baseText: 'on: push\n', headText: 'on: [push]\n' },
    ]);
  });

  it('lists every page of changed files', async () => {
    github.responses.set(
      'repos/o/r/pulls/7/files',
      pages(
        [{ filename: 'src/a.ts', status: 'modified' }],
        [{ filename: 'src/b.ts', status: 'added' }],
      ),
    );
    const { facts } = await gatherFacts(target());
    expect(facts.changedFiles).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('fails closed when a side that should exist cannot be read', async () => {
    // A modified file whose base read fails must not be treated as newly added,
    // because a new workflow is never a loosening.
    github.responses.set('repos/o/r/pulls/7/files', [
      { filename: '.github/workflows/ci.yml', status: 'modified' },
    ]);
    github.responses.set('repos/o/r/contents/.github/workflows/ci.yml?ref=head1', 'on: push\n');
    await expect(gatherFacts(target())).rejects.toThrow('could not read .github/workflows/ci.yml');
  });

  it('fails closed when the PR itself cannot be read', async () => {
    github.responses.delete('repos/o/r/pulls/7');
    await expect(gatherFacts(target())).rejects.toThrow('GET repos/o/r/pulls/7');
  });

  it('reads changed dependency manifests on both sides', async () => {
    github.responses.set('repos/o/r/pulls/7/files', [
      { filename: 'package.json', status: 'modified' },
    ]);
    github.responses.set('repos/o/r/contents/package.json?ref=base1', '{"a":1}');
    github.responses.set('repos/o/r/contents/package.json?ref=head1', '{"a":2}');
    const { facts } = await gatherFacts(target());
    expect(facts.manifestChanges).toEqual([
      { path: 'package.json', baseText: '{"a":1}', headText: '{"a":2}' },
    ]);
  });

  it('lists both paths of a rename, so moving code into docs/ is not docs-only', async () => {
    github.responses.set('repos/o/r/pulls/7/files', [
      { filename: 'docs/a.md', status: 'renamed', previous_filename: 'src/a.ts' },
    ]);
    const { facts } = await gatherFacts(target());
    expect(facts.changedFiles).toEqual(['src/a.ts', 'docs/a.md']);
  });

  it('gathers pr-lifecycle sign-off status on the head', async () => {
    github.responses.set('repos/o/r/pulls/7/files', []);
    github.responses.set('repos/o/r/commits/head1/statuses', [
      {
        context: 'pr-lifecycle/sign-off',
        state: 'success',
        description: 'v1 requirement=ci',
        creator: { login: 'bot', type: 'Bot' },
      },
    ]);
    const { facts } = await gatherFacts(target());
    expect(facts.signOffStatus).toEqual({
      state: 'success',
      description: 'v1 requirement=ci',
      creator: { login: 'bot', type: 'Bot', permission: 'none' },
    });
  });

  it('leaves the sign-off status absent when pr-lifecycle posted none', async () => {
    github.responses.set('repos/o/r/pulls/7/files', []);
    const { facts } = await gatherFacts(target());
    expect(facts).not.toHaveProperty('signOffStatus');
  });

  it('gathers who applied each sign-off label', async () => {
    github.responses.set('repos/o/r/pulls/7', { ...PR, labels: [{ name: 'UAT passed' }] });
    github.responses.set('repos/o/r/pulls/7/files', []);
    github.responses.set('repos/o/r/issues/7/events', [
      labeled('UAT passed', 'reed', '2026-10-01T13:00:00Z'),
    ]);
    github.responses.set('repos/o/r/collaborators/reed/permission', {
      permission: 'admin',
      role_name: 'admin',
    });
    github.responses.set('repos/o/r/commits/head1/check-suites', {
      check_suites: [{ created_at: '2026-10-01T12:00:00Z' }],
    });
    const { facts } = await gatherFacts(target());
    expect(facts.signOffs).toEqual([
      {
        label: 'UAT passed',
        appliedBy: { login: 'reed', type: 'User', permission: 'admin' },
        appliedAt: '2026-10-01T13:00:00Z',
      },
    ]);
  });

  it('gathers when the head was pushed while a head-bound sign-off is on the PR', async () => {
    github.responses.set('repos/o/r/pulls/7', { ...PR, labels: [{ name: 'tested' }] });
    github.responses.set('repos/o/r/pulls/7/files', []);
    github.responses.set('repos/o/r/issues/7/events', []);
    github.responses.set('repos/o/r/commits/head1/check-suites', {
      check_suites: [{ created_at: '2026-10-01T12:00:00Z' }],
    });
    const { facts } = await gatherFacts(target());
    expect(facts.headPushedAt).toBe('2026-10-01T12:00:00.000Z');
  });

  it('skips the push-time reads when only a waiver is on the PR', async () => {
    github.responses.set('repos/o/r/pulls/7', { ...PR, labels: [{ name: 'no UAT needed' }] });
    github.responses.set('repos/o/r/pulls/7/files', []);
    github.responses.set('repos/o/r/issues/7/events', []);
    const { facts } = await gatherFacts(target());
    expect(facts.headPushedAt).toBeUndefined();
  });

  it('gathers a default base without looking up the PRs it heads', async () => {
    github.responses.set('repos/o/r/pulls/7/files', []);
    const { facts } = await gatherFacts(target());
    expect(facts.base).toEqual({ branch: 'main', defaultBranch: 'main', headOf: [] });
  });

  it('gathers the open PRs heading a stacked base', async () => {
    github.responses.set('repos/o/r/pulls/7', {
      ...PR,
      base: { ref: 'feature/big', repo: { default_branch: 'main' } },
    });
    github.responses.set('repos/o/r/pulls/7/files', []);
    github.responses.set('repos/o/r/pulls?state=open&head=o%3Afeature%2Fbig&per_page=100', [
      { number: 12, labels: [{ name: 'Epic' }] },
    ]);
    const { facts } = await gatherFacts(target());
    expect(facts.base).toEqual({
      branch: 'feature/big',
      defaultBranch: 'main',
      headOf: [{ number: 12, labels: ['Epic'] }],
    });
  });

  it('fails closed when the PRs heading a stacked base cannot be listed', async () => {
    // An empty list would read as "no PR heads this branch", a different verdict.
    github.responses.set('repos/o/r/pulls/7', {
      ...PR,
      base: { ref: 'feature/big', repo: { default_branch: 'main' } },
    });
    github.responses.set('repos/o/r/pulls/7/files', []);
    await expect(gatherFacts(target())).rejects.toThrow('open PRs heading feature/big');
  });

  it('skips the merge-base lookup when no workflow file or manifest changed', async () => {
    github.responses.delete('repos/o/r/compare/main...head1');
    github.responses.set('repos/o/r/pulls/7/files', [{ filename: 'src/a.ts', status: 'added' }]);
    const { facts } = await gatherFacts(target());
    expect(facts.workflowChanges).toEqual([]);
  });
});

describe.each(await transports())('openPullRequestsAtHead over %s', (_name, makeClient) => {
  it('returns the open PRs whose head is still the SHA', async () => {
    github.responses.set('repos/o/r/commits/sha1/pulls', [
      { number: 3, state: 'open', head: { sha: 'sha1' } },
      { number: 4, state: 'closed', head: { sha: 'sha1' } },
      { number: 5, state: 'open', head: { sha: 'moved' } },
    ]);
    const prs = await openPullRequestsAtHead({ repo: 'o/r', client: makeClient() }, 'sha1');
    expect(prs).toEqual([3]);
  });

  it('throws when the lookup fails', async () => {
    await expect(
      openPullRequestsAtHead({ repo: 'o/r', client: makeClient() }, 'sha1'),
    ).rejects.toThrow('could not read repos/o/r/commits/sha1/pulls');
  });
});

describe.each(await transports())('applyLabelEdits over %s', (_name, makeClient) => {
  it('adds the planned labels and removes the planned removals', async () => {
    await applyLabelEdits(
      { repo: 'o/r', pr: 7, client: makeClient() },
      {
        outcome: 'pending',
        title: 't',
        summary: 's',
        findings: [],
        labelsToAdd: ['CI approval needed'],
        labelsToRemove: ['old label'],
      },
    );
    expect(github.writes).toEqual([
      {
        method: 'POST',
        path: 'repos/o/r/issues/7/labels',
        body: { labels: ['CI approval needed'] },
      },
      { method: 'DELETE', path: 'repos/o/r/issues/7/labels/old%20label', body: undefined },
    ]);
  });
});
