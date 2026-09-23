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
  head: { sha: 'head1' },
  base: { ref: 'main' },
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

  it('skips the merge-base lookup when no workflow file changed', async () => {
    responses.delete('repos/o/r/compare/main...head1');
    responses.set(
      'repos/o/r/pulls/7/files',
      JSON.stringify({ filename: 'src/a.ts', status: 'added' }),
    );
    const { facts } = await gatherFacts(target);
    expect(facts.workflowChanges).toEqual([]);
  });
});
