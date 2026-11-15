# pnpm-release-management

Release tooling for pnpm monorepos: change intents in `.changeset/` become versioned packages, git tags, GitHub
Releases and npm publishes, driven by repository state on every push. Other repositories call its reusable workflows
(`.github/workflows/release.yml`, `changeset-check.yml`) at `@main`.

`AGENTS.md` is the canonical instruction file. `CLAUDE.md` includes it, `subtrees.toml` and `CONSTITUTION.md`.

| Doc                                 | Read when                                                                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `CODING_STANDARDS.md`               | writing or changing code                                                                                                                        |
| `REVIEW.md`                         | reviewing a change                                                                                                                              |
| `CONTRIBUTING.md`                   | gates, commit messages, layout, adding a subcommand, the e2e test                                                                               |
| `docs/ci.md`                        | changing a reusable workflow                                                                                                                    |
| `CONSTITUTION.md`                   | architecture changes, rule authoring, or design disputes                                                                                        |
| `repos/constitution/ENFORCEMENT.md` | building or changing an instrument that grades work (lint gates, stream rules, CI checks, thresholds, rubrics, advisors); situational read only |
| `docs/solutions/`                   | before fixing a bug: past fixes and their prevention                                                                                            |

## Commands

Run everything inside the dev shell (`direnv allow` or `nix develop`).

| Command                                      | What it does                                          |
| -------------------------------------------- | ----------------------------------------------------- |
| `pnpm check:ci`                              | every gate CI runs: format, lint, types, tests, build |
| `pnpm --filter @systemfsoftware/e2e test`    | the whole release pipeline in a container             |
| `pnpm format`                                | fix formatting                                        |
| `cd release-pr && bend PROOF.bend --verdict` | check the release PR's laws with Bend's kernel        |

## Boundaries

- This repository is public. Nothing from a private repository enters it, in files, commit messages or PR text: no
  private repository, package, product or host name, no local path, person, email, private run or issue link.
- Apps address only their production hosts; the e2e container resolves only `api.github.com`.
- `repos/` holds vendored subtrees (`subtrees.toml`). Change them upstream, never here.
- A change to a package or app carries a change intent in `.changeset/`.

## Bend

When using Bend:

- run `bend guide` to learn it
- use `LAWS.bend` to keep important rules
- run `bend PROOF.bend --verdict` before committing
- parallelize the code whenever possible

`release-pr/` models the `version` job of `release.yml` and `github-release-management pr`'s decision
(`main.bend`), states the laws the release PR obeys (`LAWS.bend`, with the assumptions the proofs rely on) and proves
them (`PROOF.bend`). Change `main.bend` with the YAML or the decision it models. `LAWS.bend` and `SPEC.bend` state what the maintainers want: an agent does not edit them unless asked to change a law.

## Process

- Fix the cause of a failure, then write its learning record in `docs/solutions/` in the same PR.
- Commit messages follow `CONTRIBUTING.md`: `<type>(<scope>): <subject>`, checked by the `commit-msg` hook.
