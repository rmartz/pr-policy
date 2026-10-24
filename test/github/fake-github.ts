/**
 * A fake GitHub REST API both transports read from, so each gatherer's tests run
 * once through the `gh` client (with `ghCall` mocked) and once through the fetch
 * client (with a fake `fetch`), against the same raw API responses.
 *
 * `responses` maps an exact `repos/...` path to its raw response: a JSON value,
 * a string for raw file contents, or `pages(...)` for a list served over several
 * pages. An unlisted path fails the way each transport fails (`null` from
 * `ghCall`, a 404 from `fetch`).
 */
import type { GitHubClient } from '../../src/github/client.js';
import type { Transport } from '../../src/lib/github.js';

interface Paged {
  readonly pages: readonly unknown[][];
}

export interface Write {
  method: string;
  path: string;
  body: unknown;
}

export const github = {
  responses: new Map<string, unknown>(),
  writes: [] as Write[],
  /** Every path read, in order (each page of a paged list once). */
  reads: [] as string[],
  /** Paths whose writes fail. */
  failingWrites: new Set<string>(),
  /** What a successful write returns. */
  writeResponse: {} as unknown,
  reset(): void {
    this.responses.clear();
    this.writes.length = 0;
    this.reads.length = 0;
    this.failingWrites.clear();
    this.writeResponse = {};
  },
};

/** A list response GitHub serves over several pages. */
export function pages(...items: unknown[][]): Paged {
  return { pages: items };
}

function isPaged(value: unknown): value is Paged {
  return typeof value === 'object' && value !== null && 'pages' in value;
}

function flatten(value: unknown): unknown {
  return isPaged(value) ? value.pages.flat() : value;
}

function write(method: string, path: string, body: unknown): string | null {
  github.writes.push({ method, path, body });
  return github.failingWrites.has(path) ? null : JSON.stringify(github.writeResponse);
}

/** Stands in for the vendored `ghCall`, emulating the `gh api` flags the client uses. */
export async function fakeGhCall(primary: Transport): Promise<string | null> {
  const { argv } = primary;
  const path = argv.find((arg) => arg.startsWith('repos/')) ?? '';
  const methodAt = argv.indexOf('-X');
  if (methodAt !== -1) {
    const body: unknown = primary.stdin === undefined ? undefined : JSON.parse(primary.stdin);
    return write(argv[methodAt + 1] ?? '', path, body);
  }
  github.reads.push(path);
  if (!github.responses.has(path)) return null;
  const value = flatten(github.responses.get(path));
  const jqAt = argv.indexOf('--jq');
  if (jqAt !== -1) {
    const jq = argv[jqAt + 1] ?? '';
    const items = jq === '.[]' ? value : (value as Record<string, unknown>)[jq.slice(1, -2)];
    return (items as unknown[]).map((item) => JSON.stringify(item)).join('\n');
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Stands in for the vendored label helpers. */
export const fakeLabels = {
  addLabels: async (repo: string, issue: number, labels: string[]) =>
    write('POST', `repos/${repo}/issues/${issue}/labels`, { labels }),
  removeLabel: async (repo: string, issue: number, label: string) =>
    write('DELETE', `repos/${repo}/issues/${issue}/labels/${encodeURIComponent(label)}`, undefined),
};

const API = 'https://api.github.com/';

/** The path a URL asks for, and which page, keeping the path's encoding as written. */
function pageOf(href: string): { path: string; page: number } {
  const rest = href.slice(API.length);
  const match = rest.match(/[?&]page=(\d+)$/);
  if (match === null) return { path: rest, page: 1 };
  return { path: rest.slice(0, match.index), page: Number(match[1]) };
}

/** Stands in for `fetch`, serving the same responses over REST, with `Link` paging. */
export const fakeFetch: typeof fetch = async (input, init) => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? 'GET';
  if (method !== 'GET') {
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const out = write(method, href.slice(API.length), body);
    return out === null ? new Response('nope', { status: 403 }) : new Response(out);
  }
  const { path, page } = pageOf(href);
  if (page === 1) github.reads.push(path);
  if (!github.responses.has(path)) return new Response('Not Found', { status: 404 });
  const value = github.responses.get(path);
  if (isPaged(value)) {
    const headers = new Headers();
    if (page < value.pages.length) {
      const next = `${API}${path}${path.includes('?') ? '&' : '?'}page=${page + 1}`;
      headers.set('link', `<${API}${path}>; rel="first", <${next}>; rel="next"`);
    }
    return Response.json(value.pages[page - 1] ?? [], { headers });
  }
  return typeof value === 'string' ? new Response(value) : Response.json(value);
};

/** Each transport's client over the fake API, for `describe.each`. */
export async function transports(): Promise<[string, () => GitHubClient][]> {
  const { createGhClient } = await import('../../src/github/client.js');
  const { createFetchClient } = await import('../../src/github/fetch-client.js');
  return [
    ['gh', () => createGhClient()],
    ['fetch', () => createFetchClient({ token: 'ghs_test', fetch: fakeFetch })],
  ];
}
