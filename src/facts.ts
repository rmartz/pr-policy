import { REPO_PERMISSIONS } from './policy.js';
import { isRepoPermission } from './sign-off.js';
import type {
  FileChange,
  LabelActor,
  OpenPullRequest,
  PullRequestAuthor,
  PullRequestBase,
  PullRequestFacts,
  SignOff,
} from './policy.js';

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

function parseActor(where: string, value: unknown): LabelActor | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) throw new Error(`${where} must be an object`);
  const { login, type, permission } = value as Record<string, unknown>;
  if (typeof login !== 'string' || typeof type !== 'string') {
    throw new Error(`${where}.login / type must be strings`);
  }
  if (!isRepoPermission(permission)) {
    throw new Error(`${where}.permission must be one of ${REPO_PERMISSIONS.join(', ')}`);
  }
  return { login, type, permission };
}

function parseSignOffs(value: unknown): SignOff[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('facts.signOffs must be an array');
  return value.map((item, index) => {
    const where = `facts.signOffs[${index}]`;
    if (typeof item !== 'object' || item === null) throw new Error(`${where} must be an object`);
    const { label, appliedBy } = item as Record<string, unknown>;
    if (typeof label !== 'string') throw new Error(`${where}.label must be a string`);
    const actor = parseActor(`${where}.appliedBy`, appliedBy);
    return actor === undefined ? { label } : { label, appliedBy: actor };
  });
}

function parseAuthor(value: unknown): PullRequestAuthor | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null)
    throw new Error('facts.author must be an object');
  const { login, type } = value as Record<string, unknown>;
  if (typeof login !== 'string' || typeof type !== 'string') {
    throw new Error('facts.author.login / type must be strings');
  }
  return { login, type };
}

function parseOpenPullRequest(value: unknown, index: number): OpenPullRequest {
  const where = `facts.base.headOf[${index}]`;
  if (typeof value !== 'object' || value === null) throw new Error(`${where} must be an object`);
  const { number, labels } = value as Record<string, unknown>;
  if (typeof number !== 'number') throw new Error(`${where}.number must be a number`);
  if (!isStringArray(labels)) throw new Error(`${where}.labels must be a string array`);
  return { number, labels };
}

function parseBase(value: unknown): PullRequestBase | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) throw new Error('facts.base must be an object');
  const { branch, defaultBranch, headOf } = value as Record<string, unknown>;
  if (typeof branch !== 'string' || typeof defaultBranch !== 'string') {
    throw new Error('facts.base.branch / defaultBranch must be strings');
  }
  if (headOf !== undefined && !Array.isArray(headOf)) {
    throw new Error('facts.base.headOf must be an array');
  }
  return { branch, defaultBranch, headOf: (headOf ?? []).map(parseOpenPullRequest) };
}

/**
 * Parse and validate a JSON facts document into `PullRequestFacts`.
 * `workflowChanges`, `manifestChanges`, and `signOffs` are optional and default
 * to none; `body`, `author`, `base`, and `draft` are optional and stay absent. With no
 * `signOffs`, no sign-off label counts: trust fails closed.
 */
export function parseFacts(raw: string): PullRequestFacts {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('facts must be a JSON object');
  }
  const {
    title,
    body,
    author,
    base,
    draft,
    labels,
    changedFiles,
    workflowChanges,
    manifestChanges,
    signOffs,
  } = parsed as Record<string, unknown>;
  if (typeof title !== 'string') throw new Error('facts.title must be a string');
  if (!isOptionalString(body)) throw new Error('facts.body must be a string');
  if (draft !== undefined && typeof draft !== 'boolean') {
    throw new Error('facts.draft must be a boolean');
  }
  if (!isStringArray(labels)) throw new Error('facts.labels must be a string array');
  if (!isStringArray(changedFiles)) throw new Error('facts.changedFiles must be a string array');
  const pr: PullRequestFacts = {
    title,
    labels,
    changedFiles,
    workflowChanges: parseFileChanges('workflowChanges', workflowChanges),
    manifestChanges: parseFileChanges('manifestChanges', manifestChanges),
    signOffs: parseSignOffs(signOffs),
  };
  const parsedAuthor = parseAuthor(author);
  const parsedBase = parseBase(base);
  if (body !== undefined) pr.body = body;
  if (parsedAuthor !== undefined) pr.author = parsedAuthor;
  if (parsedBase !== undefined) pr.base = parsedBase;
  if (draft !== undefined) pr.draft = draft;
  return pr;
}
