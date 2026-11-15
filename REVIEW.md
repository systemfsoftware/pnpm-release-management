# Review

@CODING_STANDARDS.md

## Severity

- **P0:** a consumer's release goes wrong or stops. Examples: wrong or duplicate versions are offered or published, a
  release PR is opened for versions already released, pre-releases are versioned as stable, or the release commit is
  refused. Sources: the release-PR race record, #109, #74.
- **P1:** a check reports green while proving nothing (a lint gate over no files, a test asserting a copied string),
  or a failure gives no command to reproduce it. Sources:
  `docs/solutions/logic-errors/lint-gate-passes-while-linting-nothing.md`, #38, #39, #43.
- **P2:** a defect class from `CODING_STANDARDS.md` that no consumer has met yet.

## Evidence a finding needs

- A finding names the file and line, and the input or event order that breaks it.
- A fix to `version-management` is proved on real consumer checkouts built from the branch
  (`docs/solutions/workflow-issues/prove-a-bump-fix-on-real-consumer-checkouts.md`).
- An e2e claim cites the run's own summary artifact, not a green status
  (`docs/solutions/workflow-issues/read-the-e2e-summary-artifact.md`).
- A change to the `version` job of `release.yml` or to `pr`'s decision updates `release-pr/main.bend` to match, and
  `bend PROOF.bend --verdict` prints ALL PROOFS CHECK.
