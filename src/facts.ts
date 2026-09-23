import type { PullRequestFacts } from './policy.js';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Parse and validate a JSON facts document into `PullRequestFacts`. */
export function parseFacts(raw: string): PullRequestFacts {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('facts must be a JSON object');
  }
  const { title, labels, changedFiles } = parsed as Record<string, unknown>;
  if (typeof title !== 'string') throw new Error('facts.title must be a string');
  if (!isStringArray(labels)) throw new Error('facts.labels must be a string array');
  if (!isStringArray(changedFiles)) throw new Error('facts.changedFiles must be a string array');
  return { title, labels, changedFiles };
}
