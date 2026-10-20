#!/usr/bin/env node
// Thin CLI over the policy suite. All judgment lives in the library; this only
// parses arguments and talks to `gh`.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { selectChecks } from '../checks/index.js';
import { evaluatePolicy } from '../evaluate.js';
import { parseFacts } from '../facts.js';
import { postVerdict } from '../github/check-run.js';
import { applyLabelEdits, gatherFacts, openPullRequestsAtHead } from '../github/pull-request.js';
import { resolveRepoTarget } from '../lib/github.js';

const USAGE = `Usage:
  pr-policy evaluate --pr <n> [--repo <owner/repo>] [--json] [--skip-uat]
  pr-policy evaluate --sha <sha> [--repo <owner/repo>] [--json] [--skip-uat]
  pr-policy evaluate --facts <path|-> [--skip-uat]

--pr     Evaluate a live PR, post the pr-policy check-run and commit status on
         its head, and apply the label edits the checks planned. --json
         prints the evaluation instead and changes nothing.
--sha    Evaluate every open PR whose head is <sha>, as --pr does. For a
         caller's "status" trigger, which carries a SHA, not a PR: re-run when
         pr-lifecycle posts its pr-lifecycle/sign-off status.
--facts  Evaluate an offline JSON facts document ("-" reads stdin) and print
         the evaluation. Exits 1 only on "failure" ("pending" exits 0).
--skip-uat
         Don't run the UAT gate, for a repo with no user-acceptance testing.`;

async function readInput(path: string): Promise<string> {
  if (path !== '-') return readFile(path, 'utf8');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      facts: { type: 'string' },
      pr: { type: 'string' },
      sha: { type: 'string' },
      repo: { type: 'string' },
      json: { type: 'boolean' },
      'skip-uat': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (positionals[0] !== 'evaluate') {
    console.error(USAGE);
    return 2;
  }
  const checks = selectChecks({ skipUat: values['skip-uat'] });

  if (values.facts !== undefined) {
    const evaluation = await evaluatePolicy(parseFacts(await readInput(values.facts)), checks);
    console.log(JSON.stringify(evaluation, null, 2));
    return evaluation.outcome === 'failure' ? 1 : 0;
  }

  const pr = Number(values.pr);
  const bySha = values.sha !== undefined && values.pr === undefined;
  if (!bySha && (!Number.isInteger(pr) || pr <= 0)) {
    console.error(USAGE);
    return 2;
  }
  const repo = await resolveRepoTarget({ repo: values.repo });
  if (!repo) {
    console.error('Could not resolve owner/repo — pass --repo <owner/repo>.');
    return 2;
  }
  const prs = bySha ? await openPullRequestsAtHead({ repo }, values.sha ?? '') : [pr];
  if (bySha && prs.length === 0)
    console.log(`${repo}@${values.sha ?? ''}: no open PR at that head`);
  for (const number of prs) {
    await evaluateOne({ repo, pr: number }, checks, values.json === true);
  }
  return 0;
}

async function evaluateOne(
  target: { repo: string; pr: number },
  checks: ReturnType<typeof selectChecks>,
  json: boolean,
): Promise<void> {
  const { facts, headSha } = await gatherFacts(target);
  const evaluation = await evaluatePolicy(facts, checks);
  if (json) {
    console.log(JSON.stringify(evaluation, null, 2));
    return;
  }
  await applyLabelEdits(target, evaluation);
  await postVerdict(target, headSha, evaluation);
  console.log(`${target.repo}#${target.pr}: ${evaluation.outcome} — ${evaluation.title}`);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
