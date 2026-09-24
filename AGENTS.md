# Agent guide — @rmartz/pr-policy

This repo is the home of `@rmartz/pr-policy`: a suite of **read-only
classifiers**. Each one judges a fact about a pull request's **own content**
(its diff, title, and changed paths) against policy. Every check reports into
**one** `pr-policy` check-run, which the consumer's ruleset requires. See
[README.md](README.md) and the [documentation](docs/index.md).

It was scoped in **rmartz/ai-tools#302**. Read that issue before designing a new
check. It lists the planned checks, the backlog, and the open questions.

## Start and finish every task with the docs

The `docs/` bundle is this repo's working memory. Keep it accurate the way you
keep the tests green.

**At task start:**

- Read [docs/index.md](docs/index.md), then every page your change touches.
  Always read [docs/decisions.md](docs/decisions.md): it records why things are
  the way they are, and a change that contradicts it needs a new decision, not a
  quiet override.
- If you are adding a check, read [docs/adding-a-check.md](docs/adding-a-check.md).

**At task finish, in the same PR as the code:**

- **Extend.** A new check, CLI flag, input, label, or decision gets a doc page
  or a section, plus an `index.md` entry.
- **Update.** Fix anything your change made wrong. An outdated doc is worse than
  no doc.
- **Trim.** Delete what is no longer true or no longer earns its place: a
  resolved open question, a "planned" note for something that shipped, prose
  that repeats another page. Link to the one home rather than restating it.
- **Correct drift you pass.** If you notice a stale page while doing something
  else, fix it or note it in the PR. Don't leave known-wrong docs in place.

Pages follow OKF, enforced by the `okf`, `okf-index`, and `docs-links` checks.
See [docs/okf-format.md](docs/okf-format.md).

## The external names are contracts

`PR_POLICY_CHECK_NAME`, the CI gate labels, and the UAT sign-off labels
(`src/contract.ts`) are read outside this repo. Treat them as frozen;
`test/contract.test.ts` pins them. See
[docs/check-run-contract.md](docs/check-run-contract.md).

Invariants that hold whatever a future change looks like:

- **One check-run.** A new check reports findings into `pr-policy`. It never
  posts a check-run of its own, because each new name would be a fleet-wide
  required-status migration.
- **Read-only.** A check never renames the PR, edits its body, or overrides
  another party's labels. The only labels this package writes are ones it owns
  outright (`CI approval needed`). Reconcilers belong in `rmartz/pr-lifecycle`
  (rmartz/ai-tools#306).
- **Never `CI change approved`.** This package never applies it. That label is
  the human act the CI gate exists to require.
- **Waiting on a human is a `hold`, never a `block`.** A human-gated finding
  leaves `pr-policy` pending; red is reserved for problems the author can fix.
- **Content, not history.** A check's input is the PR's current state: its
  content, and who applied each sign-off label on it. If a rule needs review
  history, it belongs to the lifecycle reconciler.
- **A sign-off counts only from someone who could merge.** Read every human
  sign-off label through `signOffState` (`src/sign-off.ts`).

## Adding a CI-change indicator

1. Add its name to `LOOSENING_INDICATORS` or `AMBIGUOUS_INDICATORS` in
   `src/checks/ci-change/indicators.ts`.
2. Implement the detector in the rule module that owns that part of the
   document: `workflow-rules.ts` (`on:` and top-level blocks), `job-rules.ts`,
   `step-rules.ts`, or `common-rules.ts` (a field that reads the same on a job
   and a step).
3. Add an `it` for it in `test/checks/ci-change/`, mutating the shared fixture,
   plus the tightening counterpart that must _not_ fire it.
4. Add its row to [docs/checks/ci-change.md](docs/checks/ci-change.md).

**Don't narrow the containment backstop** to silence an `unclassified-change`.
Add a named rule instead: it gives a specific, actionable indicator.

## The vendored `src/lib/` is a traceable fork

`src/lib/github.ts` and `src/lib/bounded-subprocess.ts` are copied from
`@rmartz/github` and `@rmartz/agent-runtime`, as merge-safety and repo-hygiene
do, so the only runtime dependency is the YAML parser. Shell out only through
them. When you touch either file, check upstream for transport or rate-limit
fixes and port them across.

## Repository conformance

This repo follows the shared
[repository checklist](https://github.com/rmartz/ai/blob/main/docs/guidance/repository-checklist.md).
It **self-manages** its config: fix conformance gaps here, in a PR. Bootstrap
(`ai-ensure-*`) only seeds a new repo. Don't wait for a bootstrap re-run to fix
something.

- **Hygiene** comes from `rmartz/repo-hygiene-action`
  ([repo-hygiene.yml](.github/workflows/repo-hygiene.yml)), pinned and bumped by
  Dependabot. Every check runs at `severity: error`.
- **CI** ([ci.yml](.github/workflows/ci.yml)) runs typecheck, lint, format,
  test, build, package, and release-notes-render.
- **Merge flow:** [merge-safety](.github/workflows/merge-safety.yml) and
  [bot-automerge](.github/workflows/bot-automerge.yml). bot-automerge is safe
  only while merge-safety and the CI jobs are required checks on the default
  branch.
- **Self-consumption:** [pr-policy.yml](.github/workflows/pr-policy.yml) runs
  the released `rmartz/pr-policy-action` on this repo's PRs, and `pr-policy` is
  a required check. A check change gates this repo only after it ships through
  the Action. See [docs/distribution.md](docs/distribution.md).

## Common commands

```bash
pnpm install                 # deps (run in each worktree first)
pnpm run build               # tsup → dist (ESM + d.ts)
pnpm run typecheck           # tsc --noEmit
pnpm run lint                # eslint (incl. max-lines caps)
pnpm run format:check        # prettier --check
pnpm run test                # vitest
```

Before pushing, run `ai-pre-push-verify -C <worktree>` and fix every failure. It
re-runs the actual CI checks locally, so a green result predicts CI.

## Code standards

Most of these are enforced by eslint. The intent:

- **Strict TypeScript.** No `any`. No `@ts-ignore` (use `@ts-expect-error` with a
  reason). Favor type inference; explicit generic args are a smell. Narrow
  `unknown` input with type guards instead of casting.
- **Named exports only.** No default exports, no IIFEs. Prefer `async/await` to
  `.then()`.
- **Value sets:** default to a string union or an `as const` array. Reserve
  `enum` for internal-only sets that are never serialized raw.
- **File caps:** `max-lines` is 480 (src) and 720 (tests) via eslint. Other
  files are capped by the `file-caps` check in [`.repo-hygiene.yml`](.repo-hygiene.yml).
  Respond to a cap by extracting code, never by making it terser.
- **Pin dependencies** to full `major.minor.patch` and keep the `^` (this is a
  published library). **SHA-pin** every third-party Action with a `# vX.Y.Z`
  comment. The `package-pins` and `action-pins` checks enforce both.
- **Tests are hermetic.** `gh`, the network, and subprocesses are boundaries to
  mock. A test that reaches the network is a bug.
- **Structural, not textual.** When a check judges a structured file (a workflow
  YAML), it parses both sides and compares trees. Never regex over diff text.

## Worktrees, PRs, and releases

- **Work in a dedicated worktree** under `.git-worktrees/` (`ai-new-worktree`),
  never on `main` in the root checkout. Run `pnpm install` in a fresh worktree
  before building.
- **PR titles must be Conventional Commits.** The repo squash-merges with the
  **PR title**, so it is the only subject that reaches `main`. `!` is allowed
  only on `feat`, `fix`, `perf`, and `revert`.
- **Releases are automatic** via `semantic-release`. Every push to `main` runs
  [release.yml](.github/workflows/release.yml). It publishes to npmjs through OIDC
  trusted publishing, which is tied to the `release.yml` filename, so there is no
  `NPM_TOKEN` and renaming that workflow breaks publishing until the trusted
  publisher on npmjs is updated. It creates the tag and Release with the built-in
  `GITHUB_TOKEN`. **Don't bump
  `package.json` by hand.** Its `version` is a frozen `0.0.0` placeholder, and
  nothing commits a version back to `main`. Config lives in
  [`.releaserc.json`](.releaserc.json).
- **Version mapping (v0):** `feat:` → minor; `fix:` / `perf:` → patch. While
  pre-1.0, a breaking change (`!`) is capped at a minor bump, so an accidental
  `!` can't jump to `1.0.0`. `docs:` / `chore:` / `style:` / `refactor:` /
  `test:` / `ci:` / `build:` don't release. Dependabot uses the split-prefix
  convention (rmartz/ai#82): a production bump is `fix(deps):` → patch, and a
  dev-dependency bump is a release-less `chore(deps):`. **Leaving v0 is a
  deliberate act:** cut `1.0.0` manually and remove the cap rule.
- **Three release guards** back the automatic flow:
  [pr-title-lint.yml](.github/workflows/pr-title-lint.yml) checks the title
  before merge.
  [commit-convention.yml](.github/workflows/commit-convention.yml) is the
  post-merge tripwire, because a non-conventional subject on `main` makes
  semantic-release skip the release. The `Release notes render` job in
  [ci.yml](.github/workflows/ci.yml) runs
  [scripts/verify-changelog-render.mjs](scripts/verify-changelog-render.mjs), so
  an incompatible changelog preset fails the PR, not the post-merge run.

## Agent directive files

- **`AGENTS.md` is the single source of truth** for a directory's agent
  instructions. Write directives here, never in `CLAUDE.md`.
- **Every `AGENTS.md` has a companion `CLAUDE.md`** in the same directory, and
  vice versa. The `CLAUDE.md` contains only `@AGENTS.md`. The `md-pairing` check
  enforces this.
