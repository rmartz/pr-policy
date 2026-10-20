#!/usr/bin/env node
// Thin CLI over the policy suite. All judgment lives in the library; this only
// parses arguments and talks to `gh`.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { selectChecks } from '../checks/index.js';
import { evaluatePolicy } from '../evaluate.js';
import { parseFacts } from '../facts.js';
import { postVerdict } from '../github/check-run.js';
import { applyLabelEdits, gatherFacts } from '../github/pull-request.js';
import { loadRepoConfig } from '../github/repo-config.js';
import { resolveRepoTarget } from '../lib/github.js';
import { parseRepoConfig } from '../repo-config.js';

const USAGE = `Usage:
  pr-policy evaluate --pr <n> [--repo <owner/repo>] [--json] [--skip-uat]
  pr-policy evaluate --facts <path|-> [--config <path>] [--skip-uat]

--pr     Evaluate a live PR, post the pr-policy check-run and commit status on
         its head, and apply the label edits the checks planned. --json
         prints the evaluation instead and changes nothing. The repo config
         (.github/pr-policy.yml) is read from the PR's base branch.
--facts  Evaluate an offline JSON facts document ("-" reads stdin) and print
         the evaluation. Exits 1 only on "failure" ("pending" exits 0).
--config A local file to use as the repo config with --facts. Without it,
         the defaults apply.
--skip-uat
         Deprecated: set "uat: off" in .github/pr-policy.yml instead. Don't run
         the UAT gate, for a repo with no user-acceptance testing.`;

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
      config: { type: 'string' },
      pr: { type: 'string' },
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
  const skipUat = values['skip-uat'];
  if (skipUat) {
    console.error('warning: --skip-uat is deprecated; set "uat: off" in .github/pr-policy.yml.');
  }

  if (values.facts !== undefined) {
    const repoConfig =
      values.config === undefined
        ? undefined
        : parseRepoConfig(await readFile(values.config, 'utf8'));
    const checks = selectChecks({ skipUat, repoConfig });
    const evaluation = await evaluatePolicy(parseFacts(await readInput(values.facts)), checks);
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
  // Read from the base branch, never the head, so a PR can't turn a gate off.
  const repoConfig =
    skipUat || facts.base === undefined
      ? undefined
      : await loadRepoConfig(target, facts.base.branch);
  const evaluation = await evaluatePolicy(facts, selectChecks({ skipUat, repoConfig }));
  if (values.json) {
    console.log(JSON.stringify(evaluation, null, 2));
    return 0;
  }
  await applyLabelEdits(target, evaluation);
  await postVerdict(target, headSha, evaluation);
  console.log(`${repo}#${pr}: ${evaluation.outcome} — ${evaluation.title}`);
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
