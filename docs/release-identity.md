# Release identity

How a released `name@version` is pinned to its bytes, and what the release plan refuses when those bytes change.

A released `name@version` is immutable. The tarball a consumer downloads once is
the tarball every consumer downloads forever, so the integrity its lockfile
records for that `name@version` can never change. Nothing is published to npm,
and the registry keys a store path by its build inputs, not by `name@version`, so
only the release tooling stops a later revision from pushing other bytes under a
released version, and that is exactly what it refuses.

`release tag` records the identity when it releases. It creates an annotated tag
`<name>@v<version>` whose message is JSON:

```json
{
  "integrity": "sha512-<base64 of the .tgz bytes>",
  "files": { "package/package.json": "sha512-<base64>", "package/index.js": "sha512-<base64>" }
}
```

`--tarballs <dir>` is required on both `release plan` and `release tag`; it names
a directory of `*.tgz` (the `packages.<system>.workspace-tarballs` output, or
`pnpm -r pack --pack-destination <dir>`). A tarball's name and version come from
its own `package/package.json`, never from its filename, so a Nix output and a
`pnpm pack` output are interchangeable.

`release plan` checks identity before it plans anything else. For every member
whose current `name@version` already has a tag on the remote — except members
the pending changesets plan will move to a new version — it fetches the tag
object, recomputes `{ integrity, files }` from the tarball in `--tarballs`,
and compares. A mismatch fails the plan red, naming `package@version`, the
recorded and current hashes, and the first differing file in sorted path order.
A file present on only one side counts as differing, so a changed dependency
range surfaces as `package/package.json`. A lightweight tag or an annotation the
tool cannot parse is refused too; a release tag is never silently skipped.

Dependents always bump so the check can hold. A bare `workspace:^` packs as
`^<current version>` of the dependency, so bumping a dependency changes the
dependent's packed bytes even when its own source did not move. With
`updateInternalDependents: 'always'` (plus `updateInternalDependencies: 'patch'`),
a minor intent on one member moves every workspace dependent by a patch release,
which keeps each dependent's own `name@version` identity intact instead of
rewriting an already-released tarball.
