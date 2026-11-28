/**
 * A PR's net change, reduced to what a clean branch update or rebase leaves
 * alone, like `git patch-id`.
 *
 * The input is the compare API's file list from the merge base to a head. Each
 * file contributes its status, path (and old path), and every patch line in
 * order: added, removed, context, and `\ No newline` markers. Hunk line
 * offsets (and the header's function name) and blob SHAs are dropped: a base change merged
 * elsewhere in the file moves the offsets and changes the blob, but not the
 * PR's hunks. The context lines anchor each change in place, so a line moved
 * to another function changes the fingerprint even with the same text. A base
 * change within a hunk's context changes it too, which fails closed. A
 * conflict resolution, a review fix, or a new commit changes the hunks.
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

/**
 * Every patch line, with each hunk header reduced to a bare `@@` so the hunk
 * boundaries count but their line offsets don't. GitHub's per-file patch has
 * no `---`/`+++` file header, so a line that starts `---` is a removed line.
 */
function hunkLines(patch: string): string[] {
  return patch.split('\n').map((line) => (line.startsWith('@@') ? '@@' : line));
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
    for (const line of hunkLines(file.patch)) hash.update(`${line}\n`);
  }
  return hash.digest('hex');
}
