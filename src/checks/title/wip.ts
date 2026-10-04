/**
 * A work-in-progress marker at either end of the title: `[WIP]` in any case,
 * or a bare uppercase `WIP` word (`WIP: feat: x`, `feat: x WIP`). Only the ends
 * count, so a title that talks about the marker (`feat: block a [WIP] title`)
 * isn't mistaken for one that carries it, and lowercase `wip` in a subject
 * (`fix: wip counter overflow`) never fires.
 */
const WIP_MARKERS = [/^\[wip\]\s*/i, /^WIP(?::|\s|$)\s*/, /\s*\[wip\]$/i, /(?:^|\s)WIP$/];

/** The title with its end markers removed, and whether there was one. */
export function stripWipMarker(title: string): { title: string; marked: boolean } {
  let text = title.trim();
  let marked = false;
  for (;;) {
    const next = WIP_MARKERS.reduce((current, marker) => current.replace(marker, '').trim(), text);
    if (next === text) return { title: text, marked };
    marked = true;
    text = next;
  }
}
