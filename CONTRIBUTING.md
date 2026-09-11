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

1. Add the step to the lifecycle app that owns it, exporting a `Command` from
   `effect/unstable/cli` whose handler returns `Effect.Effect<void, ToolError>`.
2. Register it with `Command.withSubcommands` in that app's entry module, which
   holds the app's single `NodeRuntime.runMain` edge.
3. Import shared code by package name — never by a relative path that leaves
   the app directory.
4. Prove it is wired: `pnpm --filter <app> build`, then
   `pnpm --filter @systemfsoftware/e2e test`.

Apps must only address their production hosts. Never add a `localhost`, loopback
or test-only base URL: the e2e container resolves only `api.github.com` and
`registry.npmjs.org` (see the [README](README.md#end-to-end-test)), so a step
that needs a test-only host simply fails the suite.

## The end-to-end test

`pnpm --filter @systemfsoftware/e2e test` builds `e2e/Dockerfile` and runs the
pipeline inside it. Phases are named and fail fast, so a red run points at one
step.

```bash
E2E_FILTER='publish lands' pnpm --filter @systemfsoftware/e2e test   # run matching phases only
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
