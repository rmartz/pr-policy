/**
 * Detects a dependency whose declared **major** version increased. A functional
 * PR carrying one is treated as a breaking change, so the title check requires
 * its `!` (and, through the label rules, `breaking change`). Comparison is
 * structural, like {@link sensitiveBumps}: each manifest is parsed on both sides
 * and the declared versions compared.
 */
import type { FileChange } from '../../policy.js';
import { manifestVersions } from './sensitive-bump.js';

// The leading `major[.minor[.patch]]` of a spec, after any range operator or `v`:
// `^2.1.0`, `~2`, `>=2.1`, `==3.2.1`, `v4.0.0`. Anything else (`*`, `workspace:*`,
// a URL, a tag) has no comparable version and is skipped.
const LEADING_VERSION = /^[\^~=<>!v\s]*(\d+)(?:\.(\d+))?(?:\.(\d+))?/;

interface Version {
  major: number;
  text: string;
}

function parseVersion(spec: string): Version | undefined {
  const match = LEADING_VERSION.exec(spec);
  if (match === null) return undefined;
  const [, major = '0', minor = '0', patch = '0'] = match;
  return { major: Number(major), text: `${major}.${minor}.${patch}` };
}

/**
 * Every dependency whose major version went up between the two sides of any
 * manifest, as `<name> <before> → <after>`. A package only added or only
 * removed is not a bump, and a downgrade is not one either.
 */
export function majorBumps(changes: readonly FileChange[]): string[] {
  const bumps = new Set<string>();
  for (const change of changes) {
    if (change.baseText === undefined || change.headText === undefined) continue;
    const before = manifestVersions(change.path, change.baseText);
    const after = manifestVersions(change.path, change.headText);
    if (before === null || after === null) continue;
    for (const [name, spec] of after) {
      const was = before.get(name);
      if (was === undefined) continue;
      const from = parseVersion(was);
      const to = parseVersion(spec);
      if (from !== undefined && to !== undefined && to.major > from.major) {
        bumps.add(`${name} ${from.text} → ${to.text}`);
      }
    }
  }
  return [...bumps];
}
