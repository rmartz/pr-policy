import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transport } from '../../src/lib/github.js';

// `gh` is a boundary: every call is answered from this table by its exact
// REST endpoint; an unlisted endpoint fails the way `gh` does (null).
const responses = new Map<string, string>();
vi.mock('../../src/lib/github.js', () => ({
  ghCall: async (primary: Transport) => {
    const endpoint = primary.argv.find((arg) => arg.startsWith('repos/')) ?? '';
    return responses.get(endpoint) ?? null;
  },
  addLabels: vi.fn(),
  removeLabel: vi.fn(),
}));

const { gatherFacts } = await import('../../src/github/pull-request.js');

const target = { repo: 'o/r', pr: 7 };
const PR = JSON.stringify({
  title: 'ci: tweak',
  body: null,
  draft: true,
  user: { login: 'dependabot[bot]', type: 'Bot' },
  head: { sha: 'head1' },
  base: { ref: 'main', repo: { default_branch: 'main' } },
  labels: [{ name: 'DevOps' }],
});

beforeEach(() => {
  responses.clear();
  responses.set('repos/o/r/pulls/7', PR);
  responses.set(
    'repos/o/r/compare/main...head1',
    JSON.stringify({ merge_base_commit: { sha: 'base1' } }),
  );
});

describe('gatherFacts', () => {
  it('reads workflow files at the merge base and the head', async () => {
    responses.set(
      'repos/o/r/pulls/7/files',
      [
        JSON.stringify({ filename: '.github/workflows/ci.yml', status: 'modified' }),
        JSON.stringify({ filename: 'src/a.ts', status: 'modified' }),
      ].join('\n'),
    );
    responses.set('repos/o/r/contents/.github/workflows/ci.yml?ref=base1', 'on: push\n');
    responses.set('repos/o/r/contents/.github/workflows/ci.yml?ref=head1', 'on: [push]\n');
    const { facts, headSha } = await gatherFacts(target);
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

  it('fails closed when a side that should exist cannot be read', async () => {
    // A modified file whose base read fails must not be treated as newly added,
    // because a new workflow is never a loosening.
    responses.set(
      'repos/o/r/pulls/7/files',
      JSON.stringify({ filename: '.github/workflows/ci.yml', status: 'modified' }),
    );
    responses.set('repos/o/r/contents/.github/workflows/ci.yml?ref=head1', 'on: push\n');
    await expect(gatherFacts(target)).rejects.toThrow('could not read .github/workflows/ci.yml');
  });

  it('reads changed dependency manifests on both sides', async () => {
    responses.set(
      'repos/o/r/pulls/7/files',
      JSON.stringify({ filename: 'package.json', status: 'modified' }),
    );
    responses.set('repos/o/r/contents/package.json?ref=base1', '{"a":1}');
    responses.set('repos/o/r/contents/package.json?ref=head1', '{"a":2}');
    const { facts } = await gatherFacts(target);
    expect(facts.manifestChanges).toEqual([
      { path: 'package.json', baseText: '{"a":1}', headText: '{"a":2}' },
    ]);
  });

  it('lists both paths of a rename, so moving code into docs/ is not docs-only', async () => {
    responses.set(
      'repos/o/r/pulls/7/files',
      JSON.stringify({ filename: 'docs/a.md', status: 'renamed', previous_filename: 'src/a.ts' }),
    );
    const { facts } = await gatherFacts(target);
    expect(facts.changedFiles).toEqual(['src/a.ts', 'docs/a.md']);
  });

  it('gathers who applied each sign-off label', async () => {
    responses.set(
      'repos/o/r/pulls/7',
      JSON.stringify({ ...JSON.parse(PR), labels: [{ name: 'UAT passed' }] }),
    );
    responses.set('repos/o/r/pulls/7/files', '');
    responses.set(
      'repos/o/r/issues/7/events',
      JSON.stringify({ label: 'UAT passed', login: 'reed', type: 'User' }),
    );
    responses.set(
      'repos/o/r/collaborators/reed/permission',
      JSON.stringify({ permission: 'admin', role_name: 'admin' }),
    );
    const { facts } = await gatherFacts(target);
    expect(facts.signOffs).toEqual([
      { label: 'UAT passed', appliedBy: { login: 'reed', type: 'User', permission: 'admin' } },
    ]);
  });

  it('gathers a default base without looking up the PRs it heads', async () => {
    responses.set('repos/o/r/pulls/7/files', '');
    const { facts } = await gatherFacts(target);
    expect(facts.base).toEqual({ branch: 'main', defaultBranch: 'main', headOf: [] });
  });

  it('gathers the open PRs heading a stacked base', async () => {
    responses.set(
      'repos/o/r/pulls/7',
      JSON.stringify({
        ...JSON.parse(PR),
        base: { ref: 'feature/big', repo: { default_branch: 'main' } },
      }),
    );
    responses.set('repos/o/r/pulls/7/files', '');
    responses.set(
      'repos/o/r/pulls?state=open&head=o%3Afeature%2Fbig&per_page=100',
      JSON.stringify({ number: 12, labels: ['Epic'] }),
    );
    const { facts } = await gatherFacts(target);
    expect(facts.base).toEqual({
      branch: 'feature/big',
      defaultBranch: 'main',
      headOf: [{ number: 12, labels: ['Epic'] }],
    });
  });

  it('fails closed when the PRs heading a stacked base cannot be listed', async () => {
    // An empty list would read as "no PR heads this branch", a different verdict.
    responses.set(
      'repos/o/r/pulls/7',
      JSON.stringify({
        ...JSON.parse(PR),
        base: { ref: 'feature/big', repo: { default_branch: 'main' } },
      }),
    );
    responses.set('repos/o/r/pulls/7/files', '');
    await expect(gatherFacts(target)).rejects.toThrow('open PRs heading feature/big');
  });

  it('skips the merge-base lookup when no workflow file or manifest changed', async () => {
    responses.delete('repos/o/r/compare/main...head1');
    responses.set(
      'repos/o/r/pulls/7/files',
      JSON.stringify({ filename: 'src/a.ts', status: 'added' }),
    );
    const { facts } = await gatherFacts(target);
    expect(facts.workflowChanges).toEqual([]);
  });
});
