---
okf_version: 0.2
---

# Documentation

Documentation for `@rmartz/pr-policy`, written in
[Open Knowledge Format](okf-format.md).

- [What pr-policy is](overview.md): the question it answers, the one check-run
  it posts, and how it differs from merge-safety and pr-lifecycle.
- [The check-run and label contract](check-run-contract.md): the external names
  this package is bound to, and what red and green mean.
- [Policy checks](checks/index.md): one page per registered check.
- [Adding a policy check](adding-a-check.md): the module, registration, tests,
  and docs a new check needs.
- [How pr-policy reaches consuming repos](distribution.md): the package, the
  `rmartz/pr-policy-action` wrapper, and how this repo gates itself.
- [Design decisions](decisions.md): settled choices and the questions still
  open.
- [The OKF documentation format](okf-format.md): how these pages are structured
  and validated.
