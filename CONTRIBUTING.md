# Contributing

## Requirements

Enter the dev shell — it provides `node`, `pnpm`, `deno` and `dprint`:

```bash
direnv allow      # or: nix develop
pnpm install --frozen-lockfile
```

`pnpm install` runs `prepare`, which installs the `.husky/` hooks, so the
gates below run for you rather than only in CI.

## Gates

Run the same commands locally that CI runs; `pnpm check:ci` is all of them,
and CI fails when any one does.

| Gate     | Command                                   | Enforces                                              |
| -------- | ----------------------------------------- | ----------------------------------------------------- |
| format   | `pnpm format:check`                       | dprint layout over every tracked file                 |
| lint     | `pnpm lint`                               | oxlint (strict preset) over the whole tree            |
| types    | `pnpm typecheck`                          | `tsc --noEmit` over every package and app             |
| tests    | `pnpm test`                               | the vitest suites                                     |
| pipeline | `pnpm --filter @systemfsoftware/e2e test` | the whole release pipeline in a container             |
| commit   | `.husky/commit-msg`                       | the commit-message contract below                     |
| staged   | `.husky/pre-commit`                       | format, lint and types on the staged set              |
| push     | `.husky/pre-push`                         | `main` must contain `origin/main` before it is pushed |

## Commit messages

`<type>(<scope>): <subject>`, enforced by the `commit-msg` hook.

- types: `ai`, `api`, `build`, `chore`, `ci`, `deps`, `docs`, `e2e`, `feat`,
  `fix`, `improvement`, `perf`, `refactor`, `revert`, `security`, `style`, `test`
- scopes: `ci`, `deps`, `docs`, `e2e`, `gate`, `global`, `nix`, `plan`,
  `publish`, `release`, `repo`, `solutions`, `tag`, `version`
- the header takes no full stop, and AI co-author trailers and model
  references are stripped before the check runs

## Adding a subcommand

1. Add the step to the lifecycle app that owns it, as a `Command` from
   `effect/unstable/cli` declared in that app's `main.ts`.
2. Register it with `Command.withSubcommands` in that app's entry module, which
   holds the app's single `NodeRuntime.runMain` edge.
3. Import shared code by package name — never by a relative path that leaves
   the app directory.
4. Prove it is wired: `pnpm --filter <app> build`, then
   `pnpm --filter @systemfsoftware/e2e test`.

Apps must only address their production hosts. Never add a `localhost`, loopback
or test-only base URL: the e2e container resolves only `api.github.com` (see
the [the end-to-end test](#the-end-to-end-test)), so a step
that needs a test-only host simply fails the suite.

## The end-to-end test

`pnpm --filter @systemfsoftware/e2e test` builds `e2e/Dockerfile` and runs the
pipeline inside it. Phases are named and fail fast, so a red run points at one
step.

```bash
E2E_FILTER='tagging pushes' pnpm --filter @systemfsoftware/e2e test   # run matching phases only
E2E_KEEP=1 pnpm --filter @systemfsoftware/e2e test                  # leave the container up, print its id
```

Every run writes `e2e/.artifacts/<timestamp>/` — inspect `transcript.log` first
when something fails, then `summary.json` for the failing phase. Artifacts are
gitignored.

To add coverage, add a `session.phase('<name>', async (world) => { ... })` block
to `e2e/tests/pipeline.integration.test.ts` and call the app through
`world.tool('<app>', '<subcommand>', '<args>')`; the phase name is what
`E2E_FILTER` matches.

The suite is a Gherkin feature (`makeFeature`): scenario titles are
natural-language prose of a concrete situation; exact identifiers live in step
bodies, never in titles.

## Layout

One app per capability of the release lifecycle. Each app is a single
`effect/unstable/cli` program (Effect 4's CLI module) whose subcommands are the
steps of that capability.

```
apps/
  changeset-management/       changeset new | check
  version-management/         version bump | sync | sync-root
  github-release-management/  release plan | pr | tag | release
  git-hooks/                  hooks pre-commit | commit-msg
packages/*/                   the libraries every app imports by name
apps/*/dist/main.js           the tsdown bundles the workflows and the e2e image run
e2e/                          the containerised pipeline test (vitest)
```

Apps are Node programs built with tsdown into self-contained ESM bundles, then
compiled with `deno compile` into one binary each. The flake exports them, and
`packages.<system>.release-tools` joins the three release apps. A repository
takes this flake as an input, pinned by its `flake.lock`, and puts
`release-tools` in its dev shell to run the apps locally. `release.yml` and
`changeset-check.yml` do not use that pin: they build the `release-tools` of
their own commit (see [CI](docs/ci.md)). Each job sets `WORKFLOW_REPOSITORY` and
`WORKFLOW_SHA` from the `job.workflow_repository` and `job.workflow_sha`
contexts and fails when either is empty:

```bash
tools=$(nix build --no-link --print-out-paths \
  "github:${WORKFLOW_REPOSITORY:?job.workflow_repository is empty}/${WORKFLOW_SHA:?job.workflow_sha is empty}#release-tools")
nix develop --command "$tools/bin/github-release-management" plan \
  --tarballs "$(nix build --no-link --print-out-paths .#workspace-tarballs)" \
  --output "$GITHUB_OUTPUT"
```

Each app is a composition root: `main.ts` declares the `Flag`/`Argument`
surface and holds the one `NodeRuntime.runMain` edge, `boundary.ts` decodes the
invocation into the cell's request, and `render.ts` turns the decision or the
refusal into the lines that go out. A refusal surfaces as a `::error::`
workflow annotation and exit 1.

## Install, build, test and package

Enter the dev shell (`direnv allow`, or `nix develop`) for node, pnpm and
deno, then:

| Command             | What it runs                                             |
| ------------------- | -------------------------------------------------------- |
| `pnpm install`      | install the workspace (`--frozen-lockfile` in CI)        |
| `pnpm build`        | turbo: tsdown bundles every package and app              |
| `pnpm typecheck`    | turbo: `tsc --noEmit` over every package and app         |
| `pnpm lint`         | turbo: oxlint with the strict preset over the whole tree |
| `pnpm format:check` | `dprint check`                                           |
| `pnpm test`         | turbo: the vitest suites                                 |
| `pnpm check:ci`     | all of the above, the same gate CI runs                  |

Each app builds to a self-contained ESM bundle at
`apps/<app>/dist/main.js` (npm dependencies inlined, so nothing resolves at
ship time). Packaging wraps that bundle with `deno compile`:

```bash
deno compile --allow-read --allow-write --allow-run --allow-env --allow-net --allow-sys \
  --output dist/<app> dist/main.js
```

`nix build` produces the same binaries; Deno is the packager here, never the
runtime. Run an app from its bundle or its binary:

```bash
node apps/changeset-management/dist/main.js --help
./apps/changeset-management/dist/changeset-management --help
```

## End-to-end test: what the container proves

`pnpm --filter @systemfsoftware/e2e test` builds one container and drives the
entire pipeline in it: a two-package pnpm workspace, a bare git origin and a
GitHub API mock. The phases run in order under vitest and each one's failure
names itself.

The image builds the workspace with pnpm (`pnpm install --frozen-lockfile`,
`pnpm build`, then the `package` task that runs `deno compile` over each
bundle) and ships the four app binaries at `/opt/prm/<app>`. The phases drive
those binaries, never app source, so the test proves what actually ships.

What the container proves is broader than the apps. `git`, `pnpm` and `node`
are the real binaries; the workspace is a real pnpm workspace with a real
lockfile; the release PR, tags and Releases go through real git and a real
HTTP API surface.

The container is hermetic without weakening the apps. `api.github.com` is
redirected to `127.0.0.1` inside the container by
`withExtraHosts`, and a TLS front door on port 443 (plain Node, no runtime
grants to widen) terminates a certificate signed by a CA the image installs
into the system trust store. The apps therefore talk to their production URLs
with no `localhost` behaviour anywhere: no app carries a test-only host, and
no test-only base URL exists to forget to remove.

`registry.npmjs.org` is redirected the same way, but nothing publishes there:
verdaccio stands behind it as a tripwire. It keeps `publish: $all`, so a
regression that publishes succeeds at the registry instead of hiding behind an
auth error, and it writes every request to `/tmp/verdaccio/verdaccio.log`. The
last phase, `the release never publishes to npm`, sends one `GET /-/ping` and
waits for it in that log, so a tripwire that logs nothing cannot pass. It then
asserts zero `PUT` requests in the log and no package under verdaccio's storage.

Green and red runs alike leave a transcript under `e2e/.artifacts/<timestamp>/`:

| Artifact         | Contents                                    |
| ---------------- | ------------------------------------------- |
| `transcript.log` | every command, exit code, output and timing |
| `commands.jsonl` | the same records, machine readable          |
| `summary.json`   | phase names, statuses and timings           |

```bash
E2E_FILTER='tagging pushes' pnpm --filter @systemfsoftware/e2e test   # run only matching phases
E2E_KEEP=1 pnpm --filter @systemfsoftware/e2e test                  # leave the container up and print its id
```
