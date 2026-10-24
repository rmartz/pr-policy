/**
 * The one seam every GitHub call in src/github/ goes through, so the gatherers
 * and posters run the same way from the CLI (the vendored `gh` transport) and
 * from a hosted caller with only a token (`createFetchClient`).
 *
 * Every read returns `null` when the call fails, exactly like `ghCall`. Each
 * caller decides what a failure means: a read the facts depend on throws, so a
 * failure never reads as "absent".
 */
import { addLabels, ghCall, removeLabel } from '../lib/github.js';

export interface GitHubClient {
  /** GET one JSON resource (`repos/o/r/...`), or `null` on failure. */
  getJson(path: string): Promise<unknown>;
  /**
   * GET every page of a list resource, items concatenated, or `null` on
   * failure. Most list endpoints return an array; for one that wraps its items
   * in an object (`{ check_suites: [...] }`), pass that key.
   */
  list(path: string, key?: string): Promise<unknown[] | null>;
  /** GET a file's raw text from the contents API, or `null` on failure. */
  getRaw(path: string): Promise<string | null>;
  /** POST or PATCH a JSON body, returning the response JSON, or `null` on failure. */
  send(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<unknown>;
  /** Add labels to an issue or PR. Soft-fails, like the vendored helper. */
  addLabels(repo: string, issue: number, labels: readonly string[]): Promise<void>;
  /** Remove one label from an issue or PR. Soft-fails, like the vendored helper. */
  removeLabel(repo: string, issue: number, label: string): Promise<void>;
}

/** The `gh` client: the default for the CLI and the action. */
export function createGhClient(options: { cwd?: string } = {}): GitHubClient {
  const call = { cwd: options.cwd };
  const lines = (out: string) =>
    out
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line): unknown => JSON.parse(line));
  return {
    async getJson(path) {
      const out = await ghCall({ argv: ['gh', 'api', path] }, null, call);
      return out === null ? null : (JSON.parse(out) as unknown);
    },
    async list(path, key) {
      // `--jq` emits one item per line across every page, so pages concatenate.
      const jq = key === undefined ? '.[]' : `.${key}[]`;
      const out = await ghCall({ argv: ['gh', 'api', '--paginate', path, '--jq', jq] }, null, call);
      return out === null ? null : lines(out);
    },
    async getRaw(path) {
      return ghCall(
        { argv: ['gh', 'api', '-H', 'Accept: application/vnd.github.raw', path] },
        null,
        call,
      );
    },
    async send(method, path, body) {
      const out = await ghCall(
        { argv: ['gh', 'api', '-X', method, path, '--input', '-'], stdin: JSON.stringify(body) },
        null,
        call,
      );
      if (out === null) return null;
      return out.trim() === '' ? {} : (JSON.parse(out) as unknown);
    },
    async addLabels(repo, issue, labels) {
      await addLabels(repo, issue, [...labels], call);
    },
    async removeLabel(repo, issue, label) {
      await removeLabel(repo, issue, label, call);
    },
  };
}

/** Where a GitHub call goes: an explicit client, or `gh` in a working directory. */
export interface ClientTarget {
  /** The working directory for the default `gh` client. */
  cwd?: string;
  /** How to reach GitHub; defaults to the `gh` client in `cwd`. */
  client?: GitHubClient;
}

/** The target's client, or the default `gh` client in its working directory. */
export function clientOf(target: ClientTarget): GitHubClient {
  return target.client ?? createGhClient({ cwd: target.cwd });
}
