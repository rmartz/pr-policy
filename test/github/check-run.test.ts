import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PolicyEvaluation } from '../../src/evaluate.js';
import { github, transports } from './fake-github.js';

// GitHub is a boundary: both transports read and write the same fake API.
vi.mock('../../src/lib/github.js', async () => {
  const fake = await import('./fake-github.js');
  return { ghCall: fake.fakeGhCall, ...fake.fakeLabels };
});

const { checkRunBody, postCheckRun, postVerdict, statusBody } =
  await import('../../src/github/check-run.js');

function evaluation(outcome: PolicyEvaluation['outcome']): PolicyEvaluation {
  return { outcome, title: 't', summary: 's', findings: [], labelsToAdd: [], labelsToRemove: [] };
}

const RUNS = 'repos/o/r/commits/sha1/check-runs?check_name=pr-policy&filter=latest';
const now = new Date('2026-09-23T00:00:00Z');

beforeEach(() => {
  github.reset();
});

describe('checkRunBody', () => {
  it('posts pending as in_progress with no conclusion', () => {
    const body = checkRunBody(evaluation('pending'), now);
    expect(body.status).toBe('in_progress');
    expect(body).not.toHaveProperty('conclusion');
  });

  it('completes success and failure with that conclusion', () => {
    expect(checkRunBody(evaluation('failure'), now)).toMatchObject({
      status: 'completed',
      conclusion: 'failure',
      completed_at: now.toISOString(),
    });
  });
});

describe.each(await transports())('postCheckRun over %s', (_name, makeClient) => {
  const target = () => ({ repo: 'o/r', pr: 7, client: makeClient() });

  it('creates a new run when none is open on the head', async () => {
    github.responses.set(RUNS, { check_runs: [{ id: 1, status: 'completed' }] });
    await postCheckRun(target(), 'sha1', evaluation('success'));
    expect(github.writes).toMatchObject([
      {
        method: 'POST',
        path: 'repos/o/r/check-runs',
        body: { name: 'pr-policy', head_sha: 'sha1' },
      },
    ]);
  });

  it('updates the open pending run instead of leaving it orphaned', async () => {
    github.responses.set(RUNS, { check_runs: [{ id: 42, status: 'in_progress' }] });
    await postCheckRun(target(), 'sha1', evaluation('success'));
    expect(github.writes.map(({ method, path }) => [method, path])).toEqual([
      ['PATCH', 'repos/o/r/check-runs/42'],
    ]);
  });

  it('creates and looks up a run under a shadow name instead of pr-policy', async () => {
    github.responses.set(
      'repos/o/r/commits/sha1/check-runs?check_name=pr-policy%20(app)&filter=latest',
      { check_runs: [] },
    );
    await postCheckRun(target(), 'sha1', evaluation('success'), { name: 'pr-policy (app)' });
    expect(github.writes).toMatchObject([{ body: { name: 'pr-policy (app)' } }]);
  });

  it('throws when the open runs cannot be listed', async () => {
    await expect(postCheckRun(target(), 'sha1', evaluation('success'))).rejects.toThrow(
      'could not list pr-policy check-runs',
    );
  });

  it('throws when the run cannot be posted', async () => {
    github.responses.set(RUNS, { check_runs: [] });
    github.failingWrites.add('repos/o/r/check-runs');
    await expect(postCheckRun(target(), 'sha1', evaluation('success'))).rejects.toThrow(
      'could not post the pr-policy check-run',
    );
  });
});

// The commit status is what the merge gate can rely on: a GITHUB_TOKEN check-run can
// be filed into a superseded suite that the gate ignores (#24).
describe('statusBody', () => {
  it.each([
    ['success', 'success'],
    ['failure', 'failure'],
    ['pending', 'pending'],
  ] as const)('maps a %s verdict to the %s status state', (outcome, state) => {
    expect(statusBody(evaluation(outcome), undefined)).toEqual({
      state,
      context: 'pr-policy',
      description: 't',
    });
  });

  it('truncates the description to GitHub’s 140-character limit', () => {
    const long = { ...evaluation('failure'), title: 'x'.repeat(200) };
    expect(statusBody(long, undefined).description).toHaveLength(140);
  });

  it('names the status context after a shadow name', () => {
    expect(statusBody(evaluation('success'), undefined, 'pr-policy (app)')).toMatchObject({
      context: 'pr-policy (app)',
    });
  });

  it('links the Actions run when one is given', () => {
    expect(statusBody(evaluation('success'), 'https://run')).toMatchObject({
      target_url: 'https://run',
    });
  });
});

describe.each(await transports())('postVerdict over %s', (_name, makeClient) => {
  const target = () => ({ repo: 'o/r', pr: 7, client: makeClient() });
  const statuses = () => github.writes.filter((write) => write.path.includes('/statuses/'));

  it('posts the check-run and mirrors the verdict to the pr-policy commit status', async () => {
    github.responses.set(RUNS, { check_runs: [] });
    await postVerdict(target(), 'sha1', evaluation('pending'));
    expect(github.writes.some((write) => write.path === 'repos/o/r/check-runs')).toBe(true);
    expect(statuses()).toMatchObject([
      { path: 'repos/o/r/statuses/sha1', body: { state: 'pending', context: 'pr-policy' } },
    ]);
  });

  it('posts the status under the same shadow name as the run', async () => {
    github.responses.set(
      'repos/o/r/commits/sha1/check-runs?check_name=pr-policy%20(app)&filter=latest',
      { check_runs: [] },
    );
    await postVerdict(target(), 'sha1', evaluation('failure'), { name: 'pr-policy (app)' });
    expect(statuses()).toMatchObject([{ body: { context: 'pr-policy (app)' } }]);
  });

  it('only warns when the status cannot be set (no statuses: write)', async () => {
    github.responses.set(RUNS, { check_runs: [] });
    github.failingWrites.add('repos/o/r/statuses/sha1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(postVerdict(target(), 'sha1', evaluation('success'))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('statuses: write'));
    warn.mockRestore();
  });
});
