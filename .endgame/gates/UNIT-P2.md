# gate spec — UNIT-P2

## The row

`UNIT-P2`: the cyclomatic-complexity lint (max 1) on decision files fails the build.

## The slice it guards

- **interaction**: the `trust` verb — read the workspace manifests and the registry's
  trust state, decide idle vs owed, stage the owed work (or report it under `--dry-run`).
- **intercept** (SF2): `apps/npm-publish-management/src/main.ts` — the CLI entry, one
  `trust` subcommand, one `Cell.provide` + `Cell.run` at the process edge.
- **witness** (SF15, read, never a target):
  `packages/npm-publish-engine/src/__tests__/bootstrap-npm-trust.workflow.property.test.ts`.

## The forbidden shape

A decision file that decides more than once. Concretely: `bootstrapNpmTrust` today
branches inside one body over empty-workspace, `--only`-unmatched, registry-unreadable,
launcher-missing, debuts, owed items, and the dry-run split, and the shell beside it
carries hand-rolled `{ _tag: 'Execute' } as const` / `interface extends Tag` unions to
name the intermediate plans. Each of those branch points is a workflow that was never
composed. The destination is one exhaustive `Match` per decision file, with the
sequence expressed by composing workflows.

## The carrier

`oxlint` core rule `complexity`, configured at **error** (never `warn`), scoped to the
decision files so it cannot fire on test bodies or handlers:

```jsonc
{
  "overrides": [
    {
      "files": ["packages/*/src/**/*.workflow.ts"],
      "rules": { "complexity": ["error", { "max": 1 }] }
    }
  ]
}
```

## The command that must go red

Discovered, not assumed (SF16):

```
pnpm --filter @systemfsoftware/npm-publish-engine lint
```

Runs via `sh -c` from the target root. The repo-wide `pnpm lint` is deliberately not
used: it is the slowest command and the slice's proof does not need it.

## Enrollment

- **Error, never warn.** `warn` is not a resting severity.
- **Evaluator commit first, slice commit second** (SF12): the config lands in its own
  commit before any slice code.
- **The clean tree must pass it.** The existing decision files violate `max: 1` today.
  Until SF8, they are excluded **by path, named explicitly** in the gate commit — not
  softened by raising `max`, and not left as warnings. The new route must pass with no
  exclusion.
- **SF13**: this gate is proposed, never self-approved. A deferral is a legitimate
  answer and the recommended one; a timeout or a dismissal is not an answer and the
  gate stays unproposed.
