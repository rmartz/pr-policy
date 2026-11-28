/**
 * The arm marker: the PR comment in which pr-policy records the head SHA
 * auto-merge was armed on. The first line is a hidden HTML comment carrying the
 * SHA; the rest tells a reader what it is.
 *
 * The marker is only trusted when a bot authored it and nobody has edited it
 * since (src/github/auto-merge.ts). A user's token can't author a comment as a
 * bot, and a write collaborator who edits one bumps its `updated_at`, so
 * neither can forge the record.
 */

import { AUTO_MERGE_ARM_MARKER } from '../../contract.js';

const MARKER = new RegExp(`^<!-- ${AUTO_MERGE_ARM_MARKER} ([0-9a-f]{40}) -->`);

/** The comment body that records `sha` as the armed head. */
export function markerBody(sha: string): string {
  return [
    `<!-- ${AUTO_MERGE_ARM_MARKER} ${sha} -->`,
    `**pr-policy** recorded \`${sha.slice(0, 7)}\` as the head auto-merge was armed on.`,
    'If the change moves past a clean branch update or rebase, `pr-policy` fails until',
    'it is re-reviewed and auto-merge is disabled and re-enabled.',
  ].join('\n');
}

/** The SHA a marker body records, or `undefined` for any other comment. */
export function parseMarker(body: string | null | undefined): string | undefined {
  return body?.match(MARKER)?.[1];
}
