import type { FileChange, PullRequestFacts } from './policy.js';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function parseFileChange(field: string, value: unknown, index: number): FileChange {
  const where = `facts.${field}[${index}]`;
  if (typeof value !== 'object' || value === null) throw new Error(`${where} must be an object`);
  const { path, baseText, headText } = value as Record<string, unknown>;
  if (typeof path !== 'string') throw new Error(`${where}.path must be a string`);
  if (!isOptionalString(baseText) || !isOptionalString(headText)) {
    throw new Error(`${where}.baseText / headText must be strings when present`);
  }
  return { path, baseText, headText };
}

function parseFileChanges(field: string, value: unknown): FileChange[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`facts.${field} must be an array`);
  return value.map((item, index) => parseFileChange(field, item, index));
}

/**
 * Parse and validate a JSON facts document into `PullRequestFacts`.
 * `workflowChanges` and `manifestChanges` are optional and default to none.
 */
export function parseFacts(raw: string): PullRequestFacts {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('facts must be a JSON object');
  }
  const { title, labels, changedFiles, workflowChanges, manifestChanges } = parsed as Record<
    string,
    unknown
  >;
  if (typeof title !== 'string') throw new Error('facts.title must be a string');
  if (!isStringArray(labels)) throw new Error('facts.labels must be a string array');
  if (!isStringArray(changedFiles)) throw new Error('facts.changedFiles must be a string array');
  return {
    title,
    labels,
    changedFiles,
    workflowChanges: parseFileChanges('workflowChanges', workflowChanges),
    manifestChanges: parseFileChanges('manifestChanges', manifestChanges),
  };
}
