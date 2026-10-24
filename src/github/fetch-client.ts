/**
 * A token-authenticated `GitHubClient` over `fetch`, for a hosted caller with no
 * `gh` binary (a GitHub App's webhook server). It makes the same REST calls the
 * `gh` client does; it has no retry or GraphQL fallback, so a failed call
 * returns `null` (or soft-fails for labels) and the caller's next event retries.
 */
import type { GitHubClient } from './client.js';

export interface FetchClientOptions {
  /** An installation (or other) token, sent as a bearer token. */
  token: string;
  /** The REST API base, default `https://api.github.com`. */
  apiUrl?: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

const JSON_ACCEPT = 'application/vnd.github+json';
const RAW_ACCEPT = 'application/vnd.github.raw';

/** The `rel="next"` URL of a `Link` header, if any. */
export function nextPageUrl(link: string | null): string | undefined {
  if (link === null) return undefined;
  for (const part of link.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

export function createFetchClient(options: FetchClientOptions): GitHubClient {
  const apiUrl = (options.apiUrl ?? 'https://api.github.com').replace(/\/$/, '');
  const doFetch = options.fetch ?? fetch;
  const request = async (
    url: string,
    init: { method?: string; accept?: string; body?: unknown } = {},
  ): Promise<Response | null> => {
    try {
      const headers: Record<string, string> = {
        accept: init.accept ?? JSON_ACCEPT,
        authorization: `Bearer ${options.token}`,
        'x-github-api-version': '2022-11-28',
      };
      if (init.body !== undefined) headers['content-type'] = 'application/json';
      const response = await doFetch(url, {
        method: init.method ?? 'GET',
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
      return response.ok ? response : null;
    } catch {
      return null;
    }
  };
  const urlOf = (path: string) => `${apiUrl}/${path}`;
  const json = async (response: Response | null): Promise<unknown> => {
    if (response === null) return null;
    const text = await response.text();
    return text.trim() === '' ? {} : (JSON.parse(text) as unknown);
  };

  return {
    async getJson(path) {
      return json(await request(urlOf(path)));
    },
    async list(path, key) {
      const items: unknown[] = [];
      let url: string | undefined = urlOf(path);
      while (url !== undefined) {
        const response = await request(url);
        if (response === null) return null;
        const page = await json(response);
        const pageItems: unknown =
          key === undefined ? page : (page as Record<string, unknown> | null)?.[key];
        if (!Array.isArray(pageItems)) return null;
        items.push(...(pageItems as unknown[]));
        url = nextPageUrl(response.headers.get('link'));
      }
      return items;
    },
    async getRaw(path) {
      const response = await request(urlOf(path), { accept: RAW_ACCEPT });
      return response === null ? null : response.text();
    },
    async send(method, path, body) {
      return json(await request(urlOf(path), { method, body }));
    },
    async addLabels(repo, issue, labels) {
      if (labels.length === 0) return;
      await request(urlOf(`repos/${repo}/issues/${issue}/labels`), {
        method: 'POST',
        body: { labels },
      });
    },
    async removeLabel(repo, issue, label) {
      await request(urlOf(`repos/${repo}/issues/${issue}/labels/${encodeURIComponent(label)}`), {
        method: 'DELETE',
      });
    },
  };
}
