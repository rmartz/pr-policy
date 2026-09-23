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
    });
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
    [
      'a workflow change without a path',
      '{"title":"t","labels":[],"changedFiles":[],"workflowChanges":[{}]}',
      'facts.workflowChanges[0].path',
    ],
  ])('rejects %s', (_case, raw, message) => {
    expect(() => parseFacts(raw)).toThrow(message);
  });
});
