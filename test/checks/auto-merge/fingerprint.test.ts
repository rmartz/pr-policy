import { describe, expect, it } from 'vitest';
import {
  COMPARE_FILE_LIMIT,
  changeFingerprint,
} from '../../../src/checks/auto-merge/fingerprint.js';
import type { CompareFile } from '../../../src/checks/auto-merge/fingerprint.js';
import { markerBody, parseMarker } from '../../../src/checks/auto-merge/marker.js';

const file = (patch: string, extra: Partial<CompareFile> = {}): CompareFile => ({
  filename: 'src/a.ts',
  status: 'modified',
  sha: 'blob1',
  patch,
  ...extra,
});

const PATCH = '@@ -10,3 +10,4 @@ function a() {\n context\n-old\n+new\n+added\n tail';

describe('changeFingerprint', () => {
  it('matches a clean rebase: new offsets, header, and blob, same hunk', () => {
    const rebased = '@@ -40,3 +40,4 @@ function b() {\n context\n-old\n+new\n+added\n tail';
    expect(changeFingerprint([file(rebased, { sha: 'blob2' })])).toBe(
      changeFingerprint([file(PATCH)]),
    );
  });

  it('differs when the same added line moves elsewhere, since its context moves too', () => {
    const moved = '@@ -80,3 +80,4 @@\n elsewhere\n-old\n+new\n+added\n tail';
    expect(changeFingerprint([file(moved)])).not.toBe(changeFingerprint([file(PATCH)]));
  });

  it('differs when hunks are split or joined, even with the same lines', () => {
    const split = '@@ -1 +1 @@\n-a\n+b\n@@ -9 +9 @@\n-c\n+d';
    const joined = '@@ -1 +1 @@\n-a\n+b\n-c\n+d';
    expect(changeFingerprint([file(split)])).not.toBe(changeFingerprint([file(joined)]));
  });

  it('counts a trailing-newline marker', () => {
    const plain = '@@ -1 +1 @@\n-a\n+b';
    expect(changeFingerprint([file(`${plain}\n\\ No newline at end of file`)])).not.toBe(
      changeFingerprint([file(plain)]),
    );
  });

  it('ignores the order GitHub lists files in', () => {
    const b = file('@@ -1 +1 @@\n-x\n+y', { filename: 'src/b.ts' });
    expect(changeFingerprint([b, file(PATCH)])).toBe(changeFingerprint([file(PATCH), b]));
  });

  it('differs when an added or removed line changes, as a review fix or conflict resolution does', () => {
    const fixed = PATCH.replace('+added', '+added differently');
    expect(changeFingerprint([file(fixed)])).not.toBe(changeFingerprint([file(PATCH)]));
  });

  it('counts a removed line that starts with `--`', () => {
    const removed = '@@ -1 +1 @@\n--- a comment\n+x';
    expect(changeFingerprint([file(removed)])).not.toBe(
      changeFingerprint([file('@@ -1 +1 @@\n+x')]),
    );
  });

  it('differs when a file is added to the change', () => {
    const extra = file('@@ -0,0 +1 @@\n+x', { filename: 'src/new.ts', status: 'added' });
    expect(changeFingerprint([file(PATCH), extra])).not.toBe(changeFingerprint([file(PATCH)]));
  });

  it('differs when a file is renamed from a different path', () => {
    const renamed = (from: string) => file(PATCH, { status: 'renamed', previous_filename: from });
    expect(changeFingerprint([renamed('src/x.ts')])).not.toBe(
      changeFingerprint([renamed('src/y.ts')]),
    );
  });

  it('identifies a file with no patch (binary or too large) by its blob', () => {
    const binary = (sha: string) => ({ filename: 'logo.png', status: 'modified', sha });
    expect(changeFingerprint([binary('one')])).toBe(changeFingerprint([binary('one')]));
    expect(changeFingerprint([binary('one')])).not.toBe(changeFingerprint([binary('two')]));
  });

  it('refuses a file list long enough to be truncated', () => {
    const files = Array.from({ length: COMPARE_FILE_LIMIT }, (_, i) =>
      file('@@ -1 +1 @@\n+x', { filename: `f${i}` }),
    );
    expect(changeFingerprint(files)).toBeUndefined();
    expect(changeFingerprint(files.slice(1))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('arm marker', () => {
  const sha = 'c'.repeat(40);

  it('round-trips the SHA through the comment body', () => {
    expect(parseMarker(markerBody(sha))).toBe(sha);
  });

  it('ignores any other comment, including a marker quoted mid-body', () => {
    expect(parseMarker('LGTM')).toBeUndefined();
    expect(parseMarker(null)).toBeUndefined();
    expect(parseMarker(`> quoting\n${markerBody(sha)}`)).toBeUndefined();
    expect(parseMarker('<!-- pr-policy:auto-merge-armed abc -->')).toBeUndefined();
  });
});
