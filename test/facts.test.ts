import { describe, expect, it } from 'vitest';
import { parseFacts } from '../src/facts.js';

describe('parseFacts', () => {
  it('accepts a well-formed facts document', () => {
    const raw = JSON.stringify({ title: 'fix: x', labels: ['UI'], changedFiles: ['a.ts'] });
    expect(parseFacts(raw)).toEqual({ title: 'fix: x', labels: ['UI'], changedFiles: ['a.ts'] });
  });

  it.each([
    ['a non-object', '[]', 'facts must be a JSON object'],
    ['a missing title', '{"labels":[],"changedFiles":[]}', 'facts.title must be a string'],
    ['non-string labels', '{"title":"t","labels":[1],"changedFiles":[]}', 'facts.labels'],
    ['missing changedFiles', '{"title":"t","labels":[]}', 'facts.changedFiles'],
  ])('rejects %s', (_case, raw, message) => {
    expect(() => parseFacts(raw)).toThrow(message);
  });
});
