import { describe, expect, it, vi } from 'vitest';
import type { PolicyEvaluation } from '../../src/evaluate.js';
import type { Transport } from '../../src/lib/github.js';

const calls: Transport[] = [];
let openRuns = '[]';
vi.mock('../../src/lib/github.js', () => ({
  ghCall: async (primary: Transport) => {
    calls.push(primary);
    return primary.argv.includes('--jq') ? openRuns : '{}';
  },
}));

const { checkRunBody, postCheckRun } = await import('../../src/github/check-run.js');

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
