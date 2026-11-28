/**
 * A PR's net change, reduced to what a clean branch update or rebase leaves
 * alone, in the spirit of `git patch-id`.
 *
 * The input is the compare API's file list from the merge base to a head. Each
 * file contributes its status, path (and old path), and its added and removed
 * lines in order. Context lines, hunk headers (with their line offsets), and
 * blob SHAs are dropped: a base change merged around the PR's lines moves the
 * offsets and the context and changes the blobs, but not the lines the PR
 * itself adds or removes. A conflict resolution, a review fix, or a new commit
 * changes those lines, so it changes the fingerprint.
 *
 * A file GitHub serves without a patch (binary, or too large) is identified by
 * its head blob instead, which is stricter: it differs whenever the content
 * does.
 */
import { createHash } from 'node:crypto';

/** One entry of the compare API's `files`, reduced to what is read. */
export interface CompareFile {
  filename: string;
  status: string;
  previous_filename?: string | null;
  patch?: string;
  sha?: string | null;
}

/**
 * The compare API returns at most this many files. A list that long may be
 * truncated, so it can't be fingerprinted.
 */
export const COMPARE_FILE_LIMIT = 300;

function changedLines(patch: string): string[] {
  // A hunk header starts with `@@` and a context line with a space, so neither
  // survives. GitHub's per-file patch has no `---`/`+++` file header, so a line
  // that starts `---` is a removed line and counts.
  return patch.split('\n').filter((line) => line.startsWith('+') || line.startsWith('-'));
}

/**
 * The fingerprint of a merge-base comparison's files, or `undefined` when the
 * list may be truncated.
 */
export function changeFingerprint(files: readonly CompareFile[]): string | undefined {
  if (files.length >= COMPARE_FILE_LIMIT) return undefined;
  const hash = createHash('sha256');
  const sorted = [...files].sort((a, b) =>
    a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0,
  );
  for (const file of sorted) {
    hash.update(`\0file ${file.status} ${file.previous_filename ?? ''} ${file.filename}\n`);
    if (file.patch === undefined) {
      hash.update(`blob ${file.sha ?? ''}\n`);
      continue;
    }
    for (const line of changedLines(file.patch)) hash.update(`${line}\n`);
  }
  return hash.digest('hex');
}
