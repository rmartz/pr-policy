# Policy checks

One page per registered check, each bound to its module under `src/checks/`.

- [Title-type rules](title.md): the Conventional-Commit, breaking-marker, and
  `ci`-typing rules the squash title must meet, and why a shipped reusable
  workflow is product code.
- [CI-change classification](ci-change.md): structural loosening detection over
  a PR's workflow diff, and the `CI approval needed` merge gate.
- [UAT sign-off](uat.md): the hold-by-default UAT gate, the trivial-PR rules that
  exempt from it, and who can sign off.
