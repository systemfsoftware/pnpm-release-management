# Legacy tags

A repository whose releases predate this tooling has release tags of its own,
often a bare `v<version>`. Without help the plan reads the current version as
unreleased and owes a second `<name>@v<version>` tag for it. `legacyTags` names
that earlier scheme:

```jsonc
"legacyTags": { "tag": "v{version}", "through": "0.3.6" }
```

`tag` is the old tag template: `{version}` is required, `{name}` is optional.
`through` is the last version released under it. `release plan`, `release tag`
and `release github` count a publishable member as already released when its
`<name>@v<version>` tag is absent, its version is at or below `through`, and the
remote holds the legacy tag for it — but only after reading the tagged commit:
exactly one `package.json` there must name the member, must not be `private`,
and must declare the same version. Anything else is a red
`legacy-tag-unverified` refusal naming the tag, the package and what the commit
declares; the tooling never invents an identity it cannot read back. A
recognised version is a declared skip, not a silent one: `release plan` prints
`plan-release: legacy release v0.3.6 (<name>@0.3.6)` for each.

A version above `through` is never matched against the old template, so every
later release is tagged `<name>@v<version>` as usual.
