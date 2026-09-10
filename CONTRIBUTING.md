# Contributing

## Requirements

Enter the dev shell — it provides `deno`, `dprint` and the sandboxed
`comment-checker`:

```bash
direnv allow      # or: nix develop
deno task hooks:install
```

`hooks:install` sets `core.hooksPath=.githooks`, which is what makes the gates
below run for you rather than only in CI.

## Gates

Run the same commands locally that CI runs; `deno task ci` is all of them.

| Gate     | Command                                                      | Enforces                                                  |
| -------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| format   | `deno task format:check`                                     | dprint layout over every tracked file                     |
| lint     | `deno task lint`                                             | `deno lint` over the apps, the shared package and the e2e |
| types    | `deno task check`                                            | `deno check` over the same tree                           |
| pipeline | `deno task e2e`                                              | the whole release pipeline in a container                 |
| commit   | `.githooks/commit-msg` → `apps/git-hooks/main.ts commit-msg` | the commit-message contract below                         |
| staged   | `.githooks/pre-commit` → `apps/git-hooks/main.ts pre-commit` | format, lint and types on the staged set                  |
| push     | `.githooks/pre-push`                                         | `main` must contain `origin/main` before it is pushed     |

## Commit messages

`<type>(<scope>): <subject>`, enforced by `apps/git-hooks/main.ts commit-msg`.

- types: `ai`, `api`, `build`, `chore`, `ci`, `deps`, `docs`, `e2e`, `feat`,
  `fix`, `improvement`, `perf`, `refactor`, `revert`, `security`, `style`, `test`
- scopes: `ci`, `deps`, `docs`, `e2e`, `gate`, `global`, `nix`, `plan`,
  `publish`, `release`, `repo`, `solutions`, `tag`, `version`
- the header takes no full stop, and the check rejects AI co-author trailers and
  model references outright

The check also compares the type against the staged paths: an all-docs commit
cannot say `feat`, and `feat`/`fix` must touch a production source file.

## Adding a subcommand

1. Add `<step>.ts` to the lifecycle app that owns it under `apps/`, exporting a
   `Command` from `effect/unstable/cli` whose handler returns
   `Effect.Effect<void, ToolError>`.
2. Register it with `Command.withSubcommands` in that app's `main.ts`, and widen
   the shebang only if the step needs a new grant.
3. Import shared code by package name — `@systemfsoftware/release-shared/<module>`
   — never by a relative path that leaves the app directory.
4. Prove it is wired: `deno check apps/<app>/main.ts`, then `deno task e2e`.

Permissions must stay production-shaped. Never widen a grant to `localhost`, a
loopback address or a test-only base URL. The e2e container resolves only
`api.github.com` and `registry.npmjs.org` (see the
[README](README.md#end-to-end-test)), so those steps run there under exactly
their production grants — a step that needs a test-only host simply fails the
suite.

## The end-to-end test

`deno task e2e` builds `e2e/Dockerfile` and runs the pipeline inside it. Phases
are named and fail fast, so a red run points at one step.

```bash
E2E_FILTER='publish lands' deno task e2e   # run matching phases only
E2E_KEEP=1 deno task e2e                  # leave the container up, print its id
```

Every run writes `e2e/.artifacts/<timestamp>/` — inspect `transcript.log` first
when something fails, then `summary.json` for the failing phase. Artifacts are
gitignored.

To add coverage, add a `session.phase('<name>', async (world) => { ... })` block
to `e2e/pipeline.e2e.test.ts` and call the app through
`world.tool('<app>', '<subcommand>', '<args>')`; the phase name is what
`E2E_FILTER` matches.
