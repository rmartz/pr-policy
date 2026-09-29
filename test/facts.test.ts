import { describe, expect, it } from 'vitest';
import { parseFacts } from '../src/facts.js';

describe('parseFacts', () => {
  it('accepts a well-formed facts document', () => {
    const raw = JSON.stringify({ title: 'fix: x', labels: ['UI'], changedFiles: ['a.ts'] });
    expect(parseFacts(raw)).toEqual({
      title: 'fix: x',
      labels: ['UI'],
      changedFiles: ['a.ts'],
      workflowChanges: [],
      manifestChanges: [],
      signOffs: [],
    });
  });

  it('accepts sign-offs, with and without a known actor', () => {
    const signOffs = [
      { label: 'UAT passed', appliedBy: { login: 'reed', type: 'User', permission: 'admin' } },
      { label: 'no UAT needed' },
    ];
    const raw = JSON.stringify({ title: 't', labels: [], changedFiles: [], signOffs });
    expect(parseFacts(raw).signOffs).toEqual(signOffs);
  });

  it('accepts the description and author when present', () => {
    const author = { login: 'dependabot[bot]', type: 'Bot' };
    const raw = JSON.stringify({
      title: 't',
      body: 'Bumps x',
      author,
      labels: [],
      changedFiles: [],
    });
    const facts = parseFacts(raw);
    expect(facts.body).toBe('Bumps x');
    expect(facts.author).toEqual(author);
  });

  it('accepts the base branch, defaulting the PRs it heads to none', () => {
    const raw = JSON.stringify({
      title: 't',
      base: { branch: 'feature/big', defaultBranch: 'main' },
      labels: [],
      changedFiles: [],
    });
    expect(parseFacts(raw).base).toEqual({
      branch: 'feature/big',
      defaultBranch: 'main',
      headOf: [],
    });
    const headOf = [{ number: 12, labels: ['epic'] }];
    const withHead = JSON.stringify({
      title: 't',
      base: { branch: 'feature/big', defaultBranch: 'main', headOf },
      labels: [],
      changedFiles: [],
    });
    expect(parseFacts(withHead).base?.headOf).toEqual(headOf);
  });

  it('accepts workflow changes with an absent side', () => {
    const raw = JSON.stringify({
      title: 'ci: x',
      labels: [],
      changedFiles: ['.github/workflows/ci.yml'],
      workflowChanges: [{ path: '.github/workflows/ci.yml', headText: 'on: push' }],
    });
    expect(parseFacts(raw).workflowChanges).toEqual([
      { path: '.github/workflows/ci.yml', baseText: undefined, headText: 'on: push' },
    ]);
  });

  it.each([
    ['a non-object', '[]', 'facts must be a JSON object'],
    ['a missing title', '{"labels":[],"changedFiles":[]}', 'facts.title must be a string'],
    ['non-string labels', '{"title":"t","labels":[1],"changedFiles":[]}', 'facts.labels'],
    ['missing changedFiles', '{"title":"t","labels":[]}', 'facts.changedFiles'],
    ['a non-string body', '{"title":"t","body":1,"labels":[],"changedFiles":[]}', 'facts.body'],
    [
      'an author without a type',
      '{"title":"t","author":{"login":"a"},"labels":[],"changedFiles":[]}',
      'facts.author.login / type',
    ],
    [
      'a workflow change without a path',
      '{"title":"t","labels":[],"changedFiles":[],"workflowChanges":[{}]}',
      'facts.workflowChanges[0].path',
    ],
    [
      'a base without a default branch',
      '{"title":"t","base":{"branch":"x"},"labels":[],"changedFiles":[]}',
      'facts.base.branch / defaultBranch',
    ],
    [
      'a base PR without a number',
      '{"title":"t","base":{"branch":"x","defaultBranch":"main","headOf":[{"labels":[]}]},"labels":[],"changedFiles":[]}',
      'facts.base.headOf[0].number',
    ],
    [
      'a sign-off with an unknown permission',
      '{"title":"t","labels":[],"changedFiles":[],"signOffs":[{"label":"tested","appliedBy":{"login":"a","type":"User","permission":"owner"}}]}',
      'facts.signOffs[0].appliedBy.permission',
    ],
  ])('rejects %s', (_case, raw, message) => {
    expect(() => parseFacts(raw)).toThrow(message);
  });
});
