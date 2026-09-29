import { describe, expect, it, vi } from 'vitest';
import type { PolicyEvaluation } from '../../src/evaluate.js';
import type { Transport } from '../../src/lib/github.js';

const calls: Transport[] = [];
let openRuns = '[]';
let failStatus = false;
vi.mock('../../src/lib/github.js', () => ({
  ghCall: async (primary: Transport) => {
    calls.push(primary);
    if (failStatus && primary.argv.some((a) => a.includes('/statuses/'))) return null;
    return primary.argv.includes('--jq') ? openRuns : '{}';
  },
}));

const { checkRunBody, postCheckRun, postVerdict, statusBody } =
  await import('../../src/github/check-run.js');

function evaluation(outcome: PolicyEvaluation['outcome']): PolicyEvaluation {
  return { outcome, title: 't', summary: 's', findings: [], labelsToAdd: [], labelsToRemove: [] };
}

const target = { repo: 'o/r', pr: 7 };
const now = new Date('2026-09-23T00:00:00Z');

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

describe('postCheckRun', () => {
  it('creates a new run when none is open on the head', async () => {
    calls.length = 0;
    openRuns = '[{"id":1,"status":"completed"}]';
    await postCheckRun(target, 'sha1', evaluation('success'));
    const write = calls.at(-1);
    expect(write?.argv).toContain('POST');
    expect(JSON.parse(write?.stdin ?? '{}')).toMatchObject({ name: 'pr-policy', head_sha: 'sha1' });
  });

  it('updates the open pending run instead of leaving it orphaned', async () => {
    calls.length = 0;
    openRuns = '[{"id":42,"status":"in_progress"}]';
    await postCheckRun(target, 'sha1', evaluation('success'));
    const write = calls.at(-1);
    expect(write?.argv).toEqual(expect.arrayContaining(['PATCH', 'repos/o/r/check-runs/42']));
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

  it('links the Actions run when one is given', () => {
    expect(statusBody(evaluation('success'), 'https://run')).toMatchObject({
      target_url: 'https://run',
    });
  });
});

describe('postVerdict', () => {
  const statuses = () => calls.filter((c) => c.argv.some((a) => a.includes('/statuses/')));

  it('posts the check-run and mirrors the verdict to the pr-policy commit status', async () => {
    calls.length = 0;
    openRuns = '[]';
    await postVerdict(target, 'sha1', evaluation('pending'));
    expect(calls.some((c) => c.argv.includes('repos/o/r/check-runs'))).toBe(true);
    expect(statuses()).toHaveLength(1);
    expect(statuses()[0]?.argv).toContain('repos/o/r/statuses/sha1');
    expect(JSON.parse(statuses()[0]?.stdin ?? '{}')).toMatchObject({
      state: 'pending',
      context: 'pr-policy',
    });
  });

  it('only warns when the status cannot be set (no statuses: write)', async () => {
    calls.length = 0;
    openRuns = '[]';
    failStatus = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(postVerdict(target, 'sha1', evaluation('success'))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('statuses: write'));
    failStatus = false;
    warn.mockRestore();
  });
});
