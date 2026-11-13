# Configuration

The `release.jsonc` keys, the versioning surfaces and the Turbo gate. The workflows and apps read this file from the repository root.

`release.jsonc` at the repository root. Every path is relative to the root.

| Key                             | Default                     | Meaning                                                                     |
| ------------------------------- | --------------------------- | --------------------------------------------------------------------------- |
| `base`                          | required                    | branch the release PR targets                                               |
| `branch`                        | required                    | branch the release PR is opened from                                        |
| `changesetDir`                  | `.changeset`                | where pending intents live                                                  |
| `changelogDir`                  | `<changesetDir>/changelogs` | `registry` storage: where generated per-package changelogs are parked       |
| `versioning.strategy`           | required                    | `surfaces` or `changesets`                                                  |
| `versioning.manifest`           | —                           | `surfaces`: the JSON manifest that owns the version                         |
| `versioning.changelog`          | —                           | `surfaces`: the root changelog that receives the release summary            |
| `versioning.surfaces[]`         | —                           | `surfaces`: additional files rewritten on every bump                        |
| `gate.strategy`                 | required                    | `turbo` (a task graph decides) or `paths` without a root Turbo config       |
| `gate.task`                     | `build`                     | `turbo`: the task whose inputs decide the changed packages                  |
| `distribution.launcherManifest` | —                           | required only for repositories that ship platform packages                  |
| `distribution.targets[]`        | —                           | `{ target, suffix, os, cpu, libc?, runner, bin }`                           |
| `legacyTags.tag` / `.through`   | —                           | release tags cut under an earlier scheme; see [Legacy tags](legacy-tags.md) |
| `pr.title` / `pr.body`          | built-in copy               | release PR copy                                                             |

Member changelogs follow `versioning.changelog.storage` in `pnpm-workspace.yaml`, read with
`pnpm config get`. Under `repository`, `bump` adds a `## <version>` section to each moved member's
`CHANGELOG.md`, above its earlier sections, and the release phase reads that section back. Under
`registry` or unset, `bump` parks one file per moved member under `changelogDir`, and the release
phase reads that file.

A surface is one of:

| `kind`  | Fields                                                          | Example           |
| ------- | --------------------------------------------------------------- | ----------------- |
| `json`  | `path`                                                          | `package.json`    |
| `toml`  | `path` or `glob`, `header` (`[package]`, `[workspace.package]`) | `Cargo.toml`      |
| `cargo` | `path`, optional `package`                                      | `Cargo.toml`      |
| `nix`   | `path`                                                          | `nix/version.nix` |

`surfaces` versioning bumps the manifest, rewrites the version in every declared
surface, and appends the release summary to the root changelog. `changesets`
versioning drives the changesets libraries per package: the assembled release
plan decides each member's bump, workspace dependents move with it, and the
consumed intents are removed. The workspace root's `package.json` is not read, so
a private root with no `version` field versions like any other.

A `cargo` surface rewrites `[workspace.package] version` in the named manifest,
any workspace member that pins a literal `[package] version`, and every
workspace-member entry in the sibling `Cargo.lock` (registry and git
dependencies carry a `source` line and are left alone). Its optional `package`
names the workspace package whose bumped version the Cargo workspace follows;
it is required under `changesets` versioning, where there is no single version.

`paths` classifies a change by the member directory it touches, so it is for
repositories without a root Turbo config. When the root holds `turbo.json` or
`turbo.jsonc` at both the base and the head of a comparison, the paths gate
refuses before classifying anything:

```text
paths gate refused: turbo.json makes turbo the source of change evidence — set "gate": { "strategy": "turbo" } in release.jsonc
```

A pull request that adds or removes the Turbo config is still decided by
`paths`, because Turbo cannot dry-run the side without one. Under `turbo` the
check reads the pin from the root importer's `turbo` devDependency in
`pnpm-lock.yaml` and fetches the one Turbo platform package for the runner
(`@turbo/<os>-<arch>`) at that version — from the lockfile entry's `tarball`
URL when pnpm wrote one, from the public npm registry otherwise — checks the
fetched bytes against the integrity the lockfile records for that package, and
requires the extracted binary's `--version` to print the pin. It runs that
binary with `TURBO_TELEMETRY_DISABLED=1`, so a verdict needs only the caller's
checkout: no `node_modules`, no install and no dev shell. A lockfile without
the root pin, or without an integrity for that platform package, refuses with
`turbo pin unusable:`; `turbo` must be a root devDependency.
