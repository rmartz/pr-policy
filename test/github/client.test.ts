import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transport } from '../../src/lib/github.js';

// The `gh` client's contract with the vendored transport: which `gh api` argv it
// builds for each call, and how it reads the output.
const calls: { transport: Transport; cwd: string | undefined }[] = [];
let reply: string | null = '';
vi.mock('../../src/lib/github.js', () => ({
  ghCall: async (primary: Transport, _fallback: null, opts: { cwd?: string }) => {
    calls.push({ transport: primary, cwd: opts.cwd });
    return reply;
  },
  addLabels: vi.fn(),
  removeLabel: vi.fn(),
}));

const { clientOf, createGhClient } = await import('../../src/github/client.js');
const { createFetchClient } = await import('../../src/github/fetch-client.js');

beforeEach(() => {
  calls.length = 0;
  reply = '';
});

describe('createGhClient', () => {
  it('reads one resource with a plain gh api call in its working directory', async () => {
    reply = '{"a":1}';
    const out = await createGhClient({ cwd: '/repo' }).getJson('repos/o/r/pulls/7');
    expect([out, calls[0]?.transport.argv, calls[0]?.cwd]).toEqual([
      { a: 1 },
      ['gh', 'api', 'repos/o/r/pulls/7'],
      '/repo',
    ]);
  });

  it('lists every page with --paginate, one item per line', async () => {
    reply = '{"n":1}\n{"n":2}\n';
    const out = await createGhClient().list('repos/o/r/pulls/7/files');
    expect([out, calls[0]?.transport.argv]).toEqual([
      [{ n: 1 }, { n: 2 }],
      ['gh', 'api', '--paginate', 'repos/o/r/pulls/7/files', '--jq', '.[]'],
    ]);
  });

  it('lists the items under a key for a wrapped list', async () => {
    await createGhClient().list('repos/o/r/commits/s/check-suites', 'check_suites');
    expect(calls[0]?.transport.argv.slice(-2)).toEqual(['--jq', '.check_suites[]']);
  });

  it('reads raw content with the raw media type', async () => {
    reply = 'on: push\n';
    const out = await createGhClient().getRaw('repos/o/r/contents/a.yml?ref=x');
    expect([out, calls[0]?.transport.argv]).toEqual([
      'on: push\n',
      ['gh', 'api', '-H', 'Accept: application/vnd.github.raw', 'repos/o/r/contents/a.yml?ref=x'],
    ]);
  });

  it('sends a JSON body on stdin', async () => {
    reply = '{"id":3}';
    const out = await createGhClient().send('POST', 'repos/o/r/check-runs', { name: 'pr-policy' });
    expect([out, calls[0]?.transport]).toEqual([
      { id: 3 },
      {
        argv: ['gh', 'api', '-X', 'POST', 'repos/o/r/check-runs', '--input', '-'],
        stdin: '{"name":"pr-policy"}',
      },
    ]);
  });

  it('reads an empty write response as an empty object', async () => {
    reply = '';
    expect(await createGhClient().send('POST', 'repos/o/r/statuses/s', {})).toEqual({});
  });

  it.each([
    ['getJson', (c: ReturnType<typeof createGhClient>) => c.getJson('repos/o/r')],
    ['list', (c: ReturnType<typeof createGhClient>) => c.list('repos/o/r')],
    ['send', (c: ReturnType<typeof createGhClient>) => c.send('POST', 'repos/o/r', {})],
  ] as const)('returns null when %s fails', async (_name, call) => {
    reply = null;
    expect(await call(createGhClient())).toBeNull();
  });
});

describe('clientOf', () => {
  it('uses the target’s own client when it has one', () => {
    const client = createFetchClient({ token: 't', fetch: () => Promise.reject(new Error()) });
    expect(clientOf({ client })).toBe(client);
  });

  it('defaults to gh in the target’s working directory', async () => {
    reply = '{}';
    await clientOf({ cwd: '/elsewhere' }).getJson('repos/o/r');
    expect(calls[0]?.cwd).toBe('/elsewhere');
  });
});
