#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { evaluatePolicy } from '../evaluate.js';
import { parseFacts } from '../facts.js';

const USAGE = `Usage: ai-pr-policy evaluate --facts <path|->

Evaluate every policy check against a PR described by a JSON facts file
({ "title": string, "labels": string[], "changedFiles": string[] }; "-" reads
stdin) and print the pr-policy check-run report as JSON. Exits 1 when the report
is a failure.

Posting the check-run against a live PR arrives with the first check; see
docs/overview.md.`;

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
    options: { facts: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help || positionals[0] !== 'evaluate' || values.facts === undefined) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }
  const report = await evaluatePolicy(parseFacts(await readInput(values.facts)));
  console.log(JSON.stringify(report, null, 2));
  return report.conclusion === 'failure' ? 1 : 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
