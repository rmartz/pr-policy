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

  it('accepts when a sign-off was applied and when the head was pushed', () => {
    const raw = JSON.stringify({
      title: 't',
      labels: [],
      changedFiles: [],
      signOffs: [{ label: 'UAT passed', appliedAt: '2026-10-01T13:00:00Z' }],
      headPushedAt: '2026-10-01T12:00:00Z',
    });
    const facts = parseFacts(raw);
    expect(facts.signOffs[0]?.appliedAt).toBe('2026-10-01T13:00:00Z');
    expect(facts.headPushedAt).toBe('2026-10-01T12:00:00Z');
  });

  it('leaves the head push time absent when the document has none', () => {
    const raw = JSON.stringify({ title: 't', labels: [], changedFiles: [] });
    expect(parseFacts(raw)).not.toHaveProperty('headPushedAt');
  });

  it('accepts an auto-merge request, and leaves it absent otherwise', () => {
    const autoMerge = {
      enabledBy: { login: 'reed', type: 'User' },
      enabledAt: '2026-11-01T11:00:00Z',
      headSha: 'b',
      headPushedAt: '2026-11-01T10:00:00Z',
      commits: [{ login: 'dependabot[bot]', verified: true }, { verified: false }],
      armed: { sha: 'a', at: '2026-11-01T11:00:05Z' },
      armedChange: 'x',
      headChange: 'y',
    };
    const doc = { title: 't', labels: [], changedFiles: [] };
    expect(parseFacts(JSON.stringify({ ...doc, autoMerge })).autoMerge).toEqual(autoMerge);
    expect(parseFacts(JSON.stringify(doc))).not.toHaveProperty('autoMerge');
  });

  it('rejects a malformed auto-merge request', () => {
    const doc = { title: 't', labels: [], changedFiles: [] };
    const bad = (autoMerge: unknown) => () => parseFacts(JSON.stringify({ ...doc, autoMerge }));
    expect(bad('on')).toThrow('facts.autoMerge must be an object');
    expect(bad({ headSha: 'b' })).toThrow('facts.autoMerge.enabledBy must be an object');
    expect(bad({ enabledBy: { login: 'r', type: 'User' } })).toThrow(
      'facts.autoMerge.headSha must be a string',
    );
    expect(bad({ enabledBy: { login: 'r', type: 'User' }, headSha: 'b', armed: {} })).toThrow(
      'facts.autoMerge.armed.sha / at must be strings',
    );
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

  it('accepts the draft status when present, and leaves it absent otherwise', () => {
    const draft = JSON.stringify({ title: 't', draft: true, labels: [], changedFiles: [] });
    const plain = JSON.stringify({ title: 't', labels: [], changedFiles: [] });
    expect(parseFacts(draft).draft).toBe(true);
    expect(parseFacts(plain)).not.toHaveProperty('draft');
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
      'a non-boolean draft status',
      '{"title":"t","draft":"yes","labels":[],"changedFiles":[]}',
      'facts.draft must be a boolean',
    ],
    [
      'a sign-off with an unknown permission',
      '{"title":"t","labels":[],"changedFiles":[],"signOffs":[{"label":"UAT passed","appliedBy":{"login":"a","type":"User","permission":"owner"}}]}',
      'facts.signOffs[0].appliedBy.permission',
    ],
    [
      'a non-string sign-off time',
      '{"title":"t","labels":[],"changedFiles":[],"signOffs":[{"label":"UAT passed","appliedAt":1}]}',
      'facts.signOffs[0].appliedAt must be a string',
    ],
    [
      'a non-string head push time',
      '{"title":"t","labels":[],"changedFiles":[],"headPushedAt":1}',
      'facts.headPushedAt must be a string',
    ],
  ])('rejects %s', (_case, raw, message) => {
    expect(() => parseFacts(raw)).toThrow(message);
  });
});
