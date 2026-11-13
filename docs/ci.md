# CI

The two reusable workflows, their inputs, the permissions a caller grants, and how each job builds the tools it runs.

| Workflow              | Inputs                                                        | Outputs | Caller must grant                                           |
| --------------------- | ------------------------------------------------------------- | ------- | ----------------------------------------------------------- |
| `release.yml`         | `ci-workflow` (required), `artifacts-dir`                     | `phase` | `contents: write`, `pull-requests: write`, `actions: write` |
| `changeset-check.yml` | `base-sha`, `node-version`; `devshell`, `tools-ref` (ignored) |         | `contents: read`, `pull-requests: read`                     |

`phase` is what the `plan` job derived from repository state: `release` when a
version is not yet tagged, otherwise `version` when intents are pending, and
`none` when there is nothing to do. It is empty when `plan` failed. A caller
gates its own jobs on it through `needs.<caller-job>.outputs.phase`, for
example a job that should run only on a push that releases.

Every job in both workflows stops after 60 minutes, so a stuck job frees its
runner instead of holding it for GitHub's 360, and writes its wall time to the
step summary.

The `pull_request` runs of a pull request opened or updated with the workflow
token wait for a maintainer's approval, so they never run on their own.
`release pr --output <file>` appends `outcome` (`created`, `updated`, `closed`
or `vacant`), `number` and `branch` to the file. `release.yml` passes
`$GITHUB_OUTPUT`, and when the outcome is `created` or `updated` it dispatches
the caller's CI workflow (`ci-workflow`, which must accept `workflow_dispatch`)
on that branch. A failed dispatch fails the job. That gives the release PR the
checks the branch protection requires.

`release.yml` and `changeset-check.yml` run the apps built from their own
commit, not the caller's. Each job builds
`github:${{ job.workflow_repository }}/${{ job.workflow_sha }}#release-tools`,
the `release-tools` of the exact revision of this repository the caller's
`uses:` resolved to, and runs those binaries by path (`"$RELEASE_TOOLS/<app>"`).
`release.yml` runs them inside the caller's dev shell
(`nix develop --command "$RELEASE_TOOLS/<app>" …`). A caller on `@main`
therefore always gets the flags `@main` passes, whatever revision its
`flake.lock` pins for its `pnpm-release-management` input; that pin still
decides the `release-tools` in its dev shell for local use, and
`nix flake update pnpm-release-management` still moves it. The caller's
`devShells.<system>.default` must provide pnpm, the `sandbox` and
`SANDBOX_PNPM_STORE` (see [Distribution through Nix](distribution.md)).
The job needs the `job.workflow_*` context: github.com provides it (self-hosted
runners from actions/runner v2.334.0), GitHub Enterprise Server does not. A job
that cannot read it fails before running any tool. Both workflows need Nix:
they install it on hosted runners, and a self-hosted runner must provide it.

The changeset check installs nothing from the caller and enters no dev shell:
it takes the caller's checkout and its pinned pnpm (with `node-version`, on
hosted runners), builds `release-tools` at this workflow's own revision with
Nix, and runs `"$RELEASE_TOOLS/changeset-management" check` against that tree.
pnpm is there for member enumeration (`pnpm ls -r`), which reads the workspace
manifest and needs no install. Under `"gate": { "strategy": "turbo" }` the
Turbo that judges the pull request is the platform binary the check fetches
and verifies against the caller's lockfile (see [Configuration](configuration.md)),
so the job needs no `node_modules`.

`tools-ref` and `devshell` are accepted and ignored: `devshell` configured the
install the check no longer performs, and `tools-ref` never did anything.
Removing an input a caller passes fails that caller's workflow, so an input can
be dropped only once no caller passes it: a caller still passes
`tools-ref: main`, so drop it from the callers first. This repository's own CI
calls the check with no inputs.
