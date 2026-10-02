/**
 * A `[WIP]` marker anywhere in the title means the PR isn't ready to merge. It
 * matches the bracketed marker only (case-insensitive), as the fleet's old
 * `pr-title-lint.yml` did, so "WIP" inside a word or unbracketed doesn't fire.
 */
const WIP_MARKER = /\[wip\]/gi;

/** The title with every `[WIP]` marker removed, and whether there was one. */
export function stripWipMarker(title: string): { title: string; marked: boolean } {
  const stripped = title.replace(WIP_MARKER, ' ').replace(/\s+/g, ' ').trim();
  return { title: stripped, marked: stripped !== title.replace(/\s+/g, ' ').trim() };
}
