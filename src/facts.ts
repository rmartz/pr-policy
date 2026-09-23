import type { FileChange, PullRequestFacts } from './policy.js';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function parseFileChange(value: unknown, index: number): FileChange {
  const where = `facts.workflowChanges[${index}]`;
  if (typeof value !== 'object' || value === null) throw new Error(`${where} must be an object`);
  const { path, baseText, headText } = value as Record<string, unknown>;
  if (typeof path !== 'string') throw new Error(`${where}.path must be a string`);
  if (!isOptionalString(baseText) || !isOptionalString(headText)) {
    throw new Error(`${where}.baseText / headText must be strings when present`);
  }
  return { path, baseText, headText };
}

/**
 * Parse and validate a JSON facts document into `PullRequestFacts`.
 * `workflowChanges` is optional and defaults to none.
 */
export function parseFacts(raw: string): PullRequestFacts {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('facts must be a JSON object');
  }
  const { title, labels, changedFiles, workflowChanges } = parsed as Record<string, unknown>;
  if (typeof title !== 'string') throw new Error('facts.title must be a string');
  if (!isStringArray(labels)) throw new Error('facts.labels must be a string array');
  if (!isStringArray(changedFiles)) throw new Error('facts.changedFiles must be a string array');
  if (workflowChanges !== undefined && !Array.isArray(workflowChanges)) {
    throw new Error('facts.workflowChanges must be an array');
  }
  return {
    title,
    labels,
    changedFiles,
    workflowChanges: (workflowChanges ?? []).map(parseFileChange),
  };
}
