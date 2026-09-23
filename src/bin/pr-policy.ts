#!/usr/bin/env node
// Thin CLI over the policy suite. All judgment lives in the library; this only
// parses arguments and talks to `gh`.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { evaluatePolicy } from '../evaluate.js';
import { parseFacts } from '../facts.js';
import { postCheckRun } from '../github/check-run.js';
import { applyLabelEdits, gatherFacts } from '../github/pull-request.js';
import { resolveRepoTarget } from '../lib/github.js';

const USAGE = `Usage:
  ai-pr-policy evaluate --pr <n> [--repo <owner/repo>] [--json]
  ai-pr-policy evaluate --facts <path|->

--pr     Evaluate a live PR, post the pr-policy check-run on its head, and
         apply the label edits the checks planned. --json prints the
         evaluation instead and changes nothing.
--facts  Evaluate an offline JSON facts document ("-" reads stdin) and print
         the evaluation. Exits 1 only on "failure" ("pending" exits 0).`;

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
      repo: { type: 'string' },
      json: { type: 'boolean' },
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

  if (values.facts !== undefined) {
    const evaluation = await evaluatePolicy(parseFacts(await readInput(values.facts)));
    console.log(JSON.stringify(evaluation, null, 2));
    return evaluation.outcome === 'failure' ? 1 : 0;
  }

  const pr = Number(values.pr);
  if (!Number.isInteger(pr) || pr <= 0) {
    console.error(USAGE);
    return 2;
  }
  const repo = await resolveRepoTarget({ repo: values.repo });
  if (!repo) {
    console.error('Could not resolve owner/repo — pass --repo <owner/repo>.');
    return 2;
  }
  const target = { repo, pr };
  const { facts, headSha } = await gatherFacts(target);
  const evaluation = await evaluatePolicy(facts);
  if (values.json) {
    console.log(JSON.stringify(evaluation, null, 2));
    return 0;
  }
  await applyLabelEdits(target, evaluation);
  await postCheckRun(target, headSha, evaluation);
  console.log(`${repo}#${pr}: ${evaluation.outcome} — ${evaluation.title}`);
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
