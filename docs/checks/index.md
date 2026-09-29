# Policy checks

One page per registered check, each bound to its module under `src/checks/`.

- [Title-type rules](title.md): the Conventional-Commit, breaking-marker, and
  `ci`-typing rules the squash title must meet, the paths a `docs`,
  `refactor`, or `test` PR may change, and why a shipped reusable
  workflow is product code.
- [CI-change classification](ci-change.md): structural loosening detection over
  a PR's workflow diff, and the `CI approval needed` merge gate.
- [Dependabot claim verification](dependabot.md): for a PR opened by
  Dependabot, the check that its content changes only the updates its
  description claims, per ecosystem, and what is allowed but not yet verified.
- [UAT sign-off](uat.md): the hold-by-default UAT gate, the trivial-PR rules that
  exempt from it, who can sign off, and how a repo without UAT turns it off.
- [Blocking labels](merge-block.md): the hold `do not merge`, `dnm`, `blocked`,
  and `escalation needed` put on a PR, and why any actor's label counts.
