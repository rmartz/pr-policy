/**
 * Which paths a Dependabot PR may touch. Dependabot edits dependency files and
 * nothing else, so any other path on a Dependabot PR was put there by someone
 * else. The kinds split by how far this check can verify them:
 *
 * - `manifest` and `workflow` — parsed on both sides and compared against the
 *   claim ([manifests.ts](./manifests.ts), [actions.ts](./actions.ts)).
 * - `lockfile` and `other-ecosystem` — allowed, but not content-verified yet.
 *   The check says so rather than implying it read them.
 */
import { isWorkflowPath } from '../ci-change/workflow-paths.js';
import { isManifestPath } from '../title/sensitive-bump.js';
import { LOCKFILES } from '../uat/trivial.js';

export const DEPENDENCY_PATH_KINDS = [
  'manifest',
  'workflow',
  'lockfile',
  'other-ecosystem',
] as const;
export type DependencyPathKind = (typeof DEPENDENCY_PATH_KINDS)[number];

/** Manifests of ecosystems Dependabot updates that this check doesn't parse yet. */
const OTHER_ECOSYSTEM_FILES = new Set([
  'go.mod',
  'Cargo.toml',
  'pyproject.toml',
  'Pipfile',
  'setup.cfg',
  'setup.py',
  'Gemfile',
  'Gemfile.lock',
  'composer.json',
  'composer.lock',
  '.terraform.lock.hcl',
  'action.yml',
  'action.yaml',
]);

const DOCKERFILE = /^(Dockerfile|Containerfile)([.-].+)?$|\.Dockerfile$|^docker-compose.*\.ya?ml$/;

/** How this check treats a path, or `undefined` when Dependabot never edits it. */
export function dependencyPathKind(path: string): DependencyPathKind | undefined {
  if (isWorkflowPath(path)) return 'workflow';
  if (isManifestPath(path)) return 'manifest';
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (LOCKFILES.has(name)) return 'lockfile';
  if (OTHER_ECOSYSTEM_FILES.has(name) || DOCKERFILE.test(name)) return 'other-ecosystem';
  return undefined;
}
