---
title: The changeset check fetches the consumer's pinned Turbo instead of installing the workspace - Plan
type: feat
date: 2026-10-13
topic: changeset-check-fetches-pinned-turbo
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# The changeset check fetches the consumer's pinned Turbo instead of installing the workspace - Plan

## Goal Capsule

- **Objective:** A Turbo consumer's pull request gets its changeset verdict from Turbo's change evidence with no workspace install and no dev shell. The Turbo that judges it is exactly the version its lockfile pins.
- **Means:** `changeset-management check`, under `"gate": { "strategy": "turbo" }`, fetches the one Turbo platform binary the consumer's `pnpm-lock.yaml` pins, verifies it against the lockfile's integrity and the pinned version, and runs it. The reusable `changeset-check.yml` stops installing the caller's workspace.
- **Product authority:** the repository's root. One pull request off `main`; root merges.
- **Open blockers:** none.

## Product Contract

### Summary

Today the `turbo` strategy only runs where the consumer's workspace is installed: it executes `node_modules/.bin/turbo` and compares `node_modules/turbo/package.json` with the lockfile pin. The reusable check therefore installs the caller's workspace before every verdict, with plain pnpm or, under `devshell: true`, inside the caller's Nix dev shell. After this change the check needs only the caller's git checkout. It fetches `@turbo/<os>-<arch>@<pin>` once from the npm registry, checks the bytes against the `sha512` integrity the lockfile records for that package, extracts its `bin/turbo`, requires `turbo --version` to print the pin, and runs both dry runs with that binary.

### Problem Frame

- **Install-bound evidence.** `turbo-evidence.ts` refuses with `TurboPinUnusable` (`turbo not present at <root>/node_modules/.bin/turbo — run 'pnpm install --frozen-lockfile'`) unless the workspace is installed. `turbo-pin.ts` reads the installed version from `node_modules/turbo/package.json`.
- **The workflow pays for it.** `changeset-check.yml` runs `pnpm install --frozen-lockfile`, or with `devshell: true` the caller's `bootstrap` script inside `nix develop`, then runs the check inside the caller's sandbox. This repository's own Changeset lane uses `devshell: true`. Over its last three runs, the check job took 4m06s to 4m58s.
- **Pack rule.** `ci-wall-clock/light-checks-run-the-pinned-tool` says a changeset check runs its pinned tool directly, with no workspace install, dev shell or producer job, and "the tool comes from one pinned fetch and runs as fetched". `no-dev-shell-on-verdict-lanes` forbids the dev shell on a verdict lane.

### Evidence (measured 2026-10-13, Turbo 2.10.12, this repository at `1bd7289`)

- `pnpm-lock.yaml` pins `turbo` at `2.10.12` under the root importer. It records an integrity for every platform package, e.g. `'@turbo/linux-64@2.10.12': resolution: {integrity: sha512-lr7K…}`.
- `https://registry.npmjs.org/@turbo/linux-64/-/linux-64-2.10.12.tgz` hashes to exactly that integrity. Its single top directory is `turbo-linux-x64/`, not `package/`, and holds `bin/turbo`.
- In a fresh clone with no `node_modules`, under `env -i` with only `git` on `PATH`, that binary:
  - prints `2.10.12`;
  - runs `turbo run build --dry=json` with exit 0, 18 packages and 18 tasks, with task hashes identical to a run with the full `PATH`;
  - answers `turbo query` for `packageGraph` (18 nodes, 53 edges), `affectedPackages` (reasons `FileChanged` / `DependencyChanged`) and `affectedTasks` (17).
- On its first run Turbo prints that it enables anonymous telemetry, which is an outbound network call. `TURBO_TELEMETRY_DISABLED=1` turns it off.

### Requirements

- **R1.** Under the `turbo` strategy, `check` obtains Turbo from one fetch: the platform package `@turbo/<os>-<arch>` at the version the root importer pins in `pnpm-lock.yaml`. It never uses a binary from the consumer's `node_modules`, `PATH` or dev shell.
- **R2.** The fetched tarball's `sha512` must equal the integrity the lockfile records for that package, and the extracted binary's `--version` must print the pin. Otherwise `check` refuses with `TurboPinUnusable`, and the line names the package and both values (KTD5).
- **R3.** Agent-readable lines stay stable: the render stem `turbo pin unusable: change-evidence: …` and the two lockfile-pin lines (`no lockfileVersion 9.0 document … pins 'turbo' as a root devDependency`, `N documents … pin 'turbo'`) keep their wording. Missing-intent refusals and the `paths gate refused:` line are unchanged. The three install-bound details whose fix (`pnpm install --frozen-lockfile`) no longer applies are replaced by fetch-bound details (KTD5).
- **R4.** Turbo runs with telemetry disabled. It is given no remote-cache credentials and the change adds none; no networked cache is used.
- **R5.** The reusable `changeset-check.yml` installs nothing from the caller and enters no dev shell. It keeps the checkout, the Nix install and the `release-tools` build at its own revision, then runs the check. The job carries `timeout-minutes: 60` and writes its wall time to the step summary (`one-stuck-job-backstop`).
- **R6.** `devshell` and `node-version` stay accepted and ignored, like `tools-ref`, so a SHA-pinned caller that passes them keeps working when it bumps (README: "removing an input a caller passes fails that caller's workflow"). This repository's own `changeset.yml` stops passing `devshell`.
- **R7.** Repositories under `paths` behave exactly as before. No Turbo fetch happens for them.

### Acceptance Examples

- **AE1 (real consumer, CI).** This repository is a real Turbo consumer: it has `turbo.json`, `"gate": { "strategy": "turbo" }` and a pnpm 11 lockfile. Its Changeset lane calls the reusable `changeset-check.yml` with no install and passes; the step log shows the check's verdict line. Covers R1, R5.
- **AE2 (version proven).** An integration fixture serves a tarball whose integrity the fixture lockfile records and whose `bin/turbo` prints the pin. The evidence succeeds, and `raw.engineVersion` equals the lockfile pin. Covers R1, R2.
- **AE3 (mismatch fails loudly).** If the binary prints a different version, `check` refuses with `turbo pin unusable: change-evidence: fetched <pkg>@<pin> reports <v>, not the lockfile pin <pin>`. If the bytes do not match the lockfile integrity, `check` refuses with a line naming the package and both integrities. Covers R2.
- **AE4 (existing refusals).** A lockfile with no root `turbo` pin, and a lockfile stream where two documents pin it, refuse exactly as before. Covers R3.
- **AE5 (paths).** `paths-under-turbo.integration.test.ts` passes unchanged. `deleted-packages.integration.test.ts` keeps its expectations; only its fake Turbo moves from `node_modules/.bin/turbo` to the served tarball (U1). Covers R7.
- **AE6 (real CLI, no install).** The `release-tools` built by Nix, run as `changeset-management check origin/main` in a fresh clone of this repository with no `node_modules`, prints the verdict. Covers R1, R4.
- **AE7 (retired inputs accepted).** `actionlint` passes on a scratch caller, kept outside the commit, that calls the local `changeset-check.yml` with `devshell: true` and `node-version: "24"`. actionlint checks a local reusable workflow's `with:` keys against its declared inputs, so pruning either input fails the check. Covers R6.

### Scope Boundaries

- **Second intent, left out:** `e2e.yml` cancels earlier `main` runs (`group: e2e-${{ github.ref }}`, `cancel-in-progress: true`); 4 of the last 43 `main` push runs were cancelled. `heavy-suites-judge-every-main-commit` asks for more than a concurrency key: a per-SHA group with `cancel-in-progress: false` on `main`, no E2E reachable from `pull_request`, last-green-diff scoping, and the 60-minute backstop with a wall-time summary (E2E has `timeout-minutes: 30`). `sandbox.yml` shares the per-ref cancel pattern. The concurrency fix alone is two lines, but it is not tied to the changeset lane and leaves the rest of the rule unmet. Recorded as a follow-up in the pull request.
- **Not changed:** the `paths` strategy; `release.yml`; how `release-tools` is built (`nix build` at the workflow's own revision). That build comes before the first verdict step, as it already does today (setup-under-a-minute risk, pre-existing).
- **Registry:** when the lockfile entry for `@turbo/<os>-<arch>@<pin>` records a `tarball` URL (pnpm writes one for packages resolved from a registry other than the default), the fetch uses it. Otherwise it uses the public npm registry's canonical URL, where pnpm resolved the package. Either way the bytes must match the lockfile integrity.

## Planning Contract

### Key Technical Decisions

- **KTD1. The check fetches Turbo, not the workflow.** The tool already parses the lockfile (pnpm 9 and pnpm 12 streams) and owns the typed refusals. A `curl` step in YAML would re-parse the lockfile in shell, be testable only in CI, and print untyped errors. _Rejected:_ a workflow fetch step; a `tools`-side subcommand that prints the URL.
- **KTD2. The lockfile's integrity is the trust anchor.** The fetched bytes are hashed (`sha512`, base64, as `TarballLive` does) and compared with the integrity pnpm recorded for `@turbo/<os>-<arch>@<pin>`. The binary's `--version` must also print the pin, so a mislabeled tarball is caught too.
- **KTD3. Reuse in-tree pieces.** The download goes through `RegistryPort.download` (port in `release-language`, `RegistryLive` in `adoption-adapter`, which `changeset-management` already depends on). The bytes are gunzipped, then read with `parseTar`, which `tarball-adapter` exports (the `parseTar(gunzipSync(bytes))` shape `TarballLive` uses). `ChangeEvidenceLive` gains the `RegistryPort` requirement, and `main.ts` provides `RegistryLive` over `FetchHttpClient.layer`. `process-adapter` takes a workspace dependency on `tarball-adapter` for `parseTar`; it does not depend on `adoption-adapter`.
- **KTD4. One fetch, scoped, after the pin and git checks.** `turboPin` keeps its lockfile-pin checks and order, so a missing pin still refuses before git runs. The platform package's integrity and optional `tarball` URL are read from the same lockfile document when the fetch runs, just before the base worktree is created. The binary is written once into a scoped temporary directory with mode `0755`, used for both dry runs, and removed with the scope. Platform map: `linux`/`darwin`/`win32` to `linux`/`darwin`/`windows`; `x64`/`arm64` to `64`/`arm64`. The tar entry is matched as `<any top dir>/bin/turbo`, or `<any top dir>/bin/turbo.exe` on `win32`.
- **KTD5. Failure details** (each prefixed `change-evidence:`; the render adds `turbo pin unusable:`):
  - `turbo publishes no binary for <platform> <arch>`
  - `pnpm-lock.yaml records no integrity for <pkg>@<pin>, the turbo binary for <platform> <arch>`
  - `cannot fetch <pkg>@<pin> from <url>: <reason>`
  - `fetched <pkg>@<pin> has integrity <got>, not the <want> pnpm-lock.yaml records`
  - `fetched <pkg>@<pin> holds no bin/<binary>`
  - `fetched <pkg>@<pin> reports <v>, not the lockfile pin <pin>`

  These replace `turbo not present at …`, `installed turbo … does not match the lockfile pin …` and `turbo in <cwd> self-reports version …`. All three named `pnpm install --frozen-lockfile` as the fix, which is now wrong. The self-report check is dropped: both dry runs use the binary whose `--version` was already verified.
- **KTD6. Telemetry off.** `runProcess` gains an optional `env`, passed with `extendEnv: true` so it adds to the parent environment rather than replacing it. Turbo is spawned with `TURBO_TELEMETRY_DISABLED=1` (Turbo's documented opt-out). The notice Turbo prints when telemetry first turns on has broken `--dry=json` output before (vercel/turborepo#7185).
- **KTD7. Retired inputs stay declared.** `devshell` and `node-version` are described as ignored. The setup-node, pnpm, userns, plain-install and bootstrap steps are deleted.
- **KTD8. Intent.** One `.changeset/` intent names `@systemfsoftware/process-adapter` at `major`: its exported `ChangeEvidenceLive` layer gains the `RegistryPort` requirement and its refusal details change. `.changeset/command-unstartable.md` classifies a consumer-visible adapter change the same way. `changeset-management` is private and needs no intent.

### Test admission (test-layer-selection, default refuse)

- **Admitted:** the `turbo-pin.integration.test.ts` scenarios for AE2, AE3 and AE4. They pin an observable contract (the refusal lines and the verified version in the evidence) through the published `ChangeEvidenceLive`, with a real filesystem, real hashing, tar parsing and process spawn. Only `fetch`, the external registry boundary, is replaced.
- **Adapted, not new:** `deleted-packages.integration.test.ts` keeps its scenarios and only changes how its fake Turbo reaches the run.
- **Refused:** a unit test of the platform-to-package-name map (the AE2 scenario reaches it); a test that the workflow has no install step (it would assert file text, and AE1 proves it in CI); a networked test against the real registry (CI's Changeset lane is that test).

### Assumptions challenged (destructive review)

1. _Every lockfile records the runner's platform package._ pnpm writes every optional platform package of `turbo` into `packages:`. A lockfile without the entry refuses with the KTD5 line instead of guessing.
2. _The tarball's top directory is `package/`._ It is not (`turbo-linux-x64/`); the entry is matched as `<any>/bin/turbo`.
3. _An install-free Turbo judges like an installed one._ Measured: task hashes are identical with and without the full `PATH`, and the base-side dry run already ran in a worktree with no `node_modules` before this change.
4. _The check binary needs node._ Checked against the Nix-built `release-tools` before U2 removes setup-node.
5. _Self-hosted runners reach the npm registry._ They already reach GitHub and the Nix cache; an unreachable registry fails with the `cannot fetch` line rather than a skipped gate.
6. _pnpm 12 streams put `packages:` in the importer's document._ The pin and integrity are read from the same document, and the stream fixture covers it.

### Implementation Units

#### U1. Fetch the pinned Turbo inside change evidence

- **Files:** `packages/process-adapter/src/turbo-pin.ts`, `turbo-pin.schema.ts`, `turbo-evidence.ts`, `ChangeEvidenceLive.ts`, `ProcessRun.ts`, `package.json`; `apps/changeset-management/src/main.ts`; `pnpm-lock.yaml`.
- **Approach:** `turboPin` keeps returning the pin and drops the installed-version check. A new `turbo-fetch.ts` reads the platform package's integrity and optional `tarball` URL from the lockfile document that pins Turbo, downloads through `RegistryPort`, verifies, extracts and version-checks the binary, all in the caller's scope. `collectTurboEvidence` fetches once and passes the binary path to both dry runs in place of `root/node_modules/.bin/turbo`. `InstalledTurbo` and `TURBO_MANIFEST` are deleted.
- **Test scenarios:** AE2, AE3 and AE4 in `turbo-pin.integration.test.ts`. A stubbed `fetch` at the network boundary (the `adoption.integration.test.ts` pattern) serves a tarball built in-test with the gzipping `build-tarball` fixture both adapter suites already carry. Its `bin/turbo` extends the fake dry-run script the suites use: it prints the pin for `--version` and the dry-run JSON for `run <task> --dry=json`. The fixture lockfile records that tarball's integrity. `deleted-packages.integration.test.ts` moves from planting `node_modules/.bin/turbo` to the same served tarball.
- **Verification:** the process-adapter suites pass. `typecheck`, `lint` and `format:check` pass.

#### U2. Install-free reusable check

- **Files:** `.github/workflows/changeset-check.yml`, `.github/workflows/changeset.yml`, `README.md`, `.changeset/` intent (KTD8).
- **Approach:** delete the setup-node, pnpm, userns, plain-install and bootstrap steps and the dev-shell branch of the check step. Mark `devshell` and `node-version` ignored. Add `timeout-minutes: 60`, a start-time step and a wall-time summary step. `changeset.yml` drops `devshell: true`. README's input table and CI section describe the install-free check and the fetched Turbo.
- **Verification:** `actionlint` exits 0. AE7 with a scratch caller. AE1 on the pull request's own Changeset lane; AE6 locally.

### Verification Contract

| Row           | Command                                                                                                            | Proves                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| Suites        | `pnpm --filter @systemfsoftware/process-adapter exec vitest run`                                                   | AE2, AE3, AE4, AE5                        |
| Static        | `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `actionlint`, `actionlint` on the AE7 scratch caller           | types, lint, format, workflow syntax, AE7 |
| Real CLI      | `nix build .#release-tools`, then `changeset-management check origin/main` in a fresh clone with no `node_modules` | AE6, R4                                   |
| CI            | the pull request's Changeset lane (calls the reusable check, no install)                                           | AE1, R5                                   |
| Package tests | `pnpm exec turbo run test --filter='!@systemfsoftware/e2e'`                                                        | no regression elsewhere                   |

Mutation testing does not run locally; mutation evidence comes from `main` CI.

## Definition of Done

- U1 and U2 landed; every Verification Contract row is executed and recorded in the pull request.
- The pull request's Changeset job runs no install and no dev shell, and its job time is reported.
- No skip, retry, `continue-on-error`, disabled gate or shortened timeout.
