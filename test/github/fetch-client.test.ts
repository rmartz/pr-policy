import { describe, expect, it } from 'vitest';
import { createFetchClient, nextPageUrl } from '../../src/github/fetch-client.js';

interface Seen {
  url: string;
  init: RequestInit | undefined;
}

function recording(respond: (url: string) => Response | Promise<Response>): {
  fetch: typeof fetch;
  seen: Seen[];
} {
  const seen: Seen[] = [];
  return {
    seen,
    fetch: async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      seen.push({ url, init });
      return respond(url);
    },
  };
}

describe('createFetchClient', () => {
  it('sends the token as a bearer token to the API base', async () => {
    const { fetch, seen } = recording(() => Response.json({ ok: true }));
    await createFetchClient({ token: 'ghs_abc', fetch }).getJson('repos/o/r/pulls/7');
    expect([seen[0]?.url, new Headers(seen[0]?.init?.headers).get('authorization')]).toEqual([
      'https://api.github.com/repos/o/r/pulls/7',
      'Bearer ghs_abc',
    ]);
  });

  it('honours a custom API base without doubling the slash', async () => {
    const { fetch, seen } = recording(() => Response.json({}));
    await createFetchClient({ token: 't', apiUrl: 'https://ghe.example/api/v3/', fetch }).getJson(
      'repos/o/r',
    );
    expect(seen[0]?.url).toBe('https://ghe.example/api/v3/repos/o/r');
  });

  it('returns null for an HTTP error', async () => {
    const { fetch } = recording(() => new Response('Not Found', { status: 404 }));
    expect(await createFetchClient({ token: 't', fetch }).getJson('repos/o/r')).toBeNull();
  });

  it('returns null when the request itself throws', async () => {
    const client = createFetchClient({
      token: 't',
      fetch: () => Promise.reject(new Error('offline')),
    });
    expect(await client.getJson('repos/o/r')).toBeNull();
  });

  it('follows Link pagination and concatenates the pages', async () => {
    const { fetch, seen } = recording((url) =>
      url.endsWith('page=2')
        ? Response.json([{ n: 2 }])
        : Response.json([{ n: 1 }], {
            headers: { link: `<${url}?page=2>; rel="next", <${url}?page=2>; rel="last"` },
          }),
    );
    const items = await createFetchClient({ token: 't', fetch }).list('repos/o/r/pulls/7/files');
    expect([items, seen.length]).toEqual([[{ n: 1 }, { n: 2 }], 2]);
  });

  it('reads the items of a list wrapped in an object', async () => {
    const { fetch } = recording(() => Response.json({ total_count: 1, check_suites: [{ id: 9 }] }));
    const items = await createFetchClient({ token: 't', fetch }).list(
      'repos/o/r/x',
      'check_suites',
    );
    expect(items).toEqual([{ id: 9 }]);
  });

  it('fails a list when a later page fails, rather than returning part of it', async () => {
    const { fetch } = recording((url) =>
      url.endsWith('page=2')
        ? new Response('boom', { status: 502 })
        : Response.json([{ n: 1 }], { headers: { link: `<${url}?page=2>; rel="next"` } }),
    );
    expect(await createFetchClient({ token: 't', fetch }).list('repos/o/r/x')).toBeNull();
  });

  it('fails a list whose page is not a list', async () => {
    const { fetch } = recording(() => Response.json({ message: 'odd' }));
    expect(await createFetchClient({ token: 't', fetch }).list('repos/o/r/x')).toBeNull();
  });

  it('asks for raw content and returns the text', async () => {
    const { fetch, seen } = recording(() => new Response('on: push\n'));
    const text = await createFetchClient({ token: 't', fetch }).getRaw('repos/o/r/contents/a.yml');
    expect([text, new Headers(seen[0]?.init?.headers).get('accept')]).toEqual([
      'on: push\n',
      'application/vnd.github.raw',
    ]);
  });

  it('sends a JSON body and returns the response JSON', async () => {
    const { fetch, seen } = recording(() => Response.json({ id: 5 }, { status: 201 }));
    const out = await createFetchClient({ token: 't', fetch }).send(
      'PATCH',
      'repos/o/r/check-runs/5',
      {
        status: 'completed',
      },
    );
    expect([out, seen[0]?.init?.method, seen[0]?.init?.body]).toEqual([
      { id: 5 },
      'PATCH',
      '{"status":"completed"}',
    ]);
  });

  it('treats an empty success body as an empty object', async () => {
    const { fetch } = recording(() => new Response(null, { status: 204 }));
    expect(await createFetchClient({ token: 't', fetch }).send('POST', 'repos/o/r/x', {})).toEqual(
      {},
    );
  });

  it('makes no call to add an empty label list', async () => {
    const { fetch, seen } = recording(() => Response.json([]));
    await createFetchClient({ token: 't', fetch }).addLabels('o/r', 7, []);
    expect(seen).toEqual([]);
  });

  it('soft-fails a label write', async () => {
    const { fetch } = recording(() => new Response('nope', { status: 403 }));
    await expect(
      createFetchClient({ token: 't', fetch }).removeLabel('o/r', 7, 'x'),
    ).resolves.toBeUndefined();
  });
});

describe('nextPageUrl', () => {
  it('finds the next link among others', () => {
    expect(nextPageUrl('<https://a/x?page=1>; rel="prev", <https://a/x?page=3>; rel="next"')).toBe(
      'https://a/x?page=3',
    );
  });

  it('is undefined on the last page', () => {
    expect(nextPageUrl('<https://a/x?page=1>; rel="first"')).toBeUndefined();
  });

  it('is undefined with no Link header', () => {
    expect(nextPageUrl(null)).toBeUndefined();
  });
});
