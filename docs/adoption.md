# Adoption and legacy tags

Recording the bytes of releases that predate this tooling, and naming the older tag scheme.

A repository that adopts this tooling already has release tags — systemfsoftware's
are all lightweight — whose bytes this tooling never recorded. Adoption makes the
record once, before the first managed release, so those tags are never trusted
from nothing.

Adoption reads the npm registry, where the versions of a repository that once
published there still live. It does not read nix.systemfsoftware.com.

```sh
github-release-management adopt \
  --registry https://registry.npmjs.org \
  --output release-ledger.json
```

`--registry <url>` is required and has no default. Adoption reads every release
tag `<name>@v<version>` on `--remote` (`origin` by default) — not only the
current version of a current member. The published name comes from the manifest
at the tagged commit, never from the tag string alone: adoption reads every
`package.json` in that commit's tree and takes the one whose `name` equals the
tag name or ends with `/<tag name>`. So a
tag left over from before a package was scoped (`hex-schema@v1.0.0`, whose
manifest says `@systemfsoftware/hex-schema`) resolves to the name the registry
actually serves. Exactly one match is required; zero or several matches is a hard
error naming the tag and the candidate names. When the manifest's version differs
from the tag's, the entry is `mismatched` and records both versions. It fetches
the published
`<name>@<version>` from the registry, downloads `dist.tarball`, and records one
entry:

```json
{
  "entries": [
    {
      "_tag": "published",
      "tag": "@scope/name@v1.2.3",
      "commit": "<peeled commit the tag points to>",
      "package": "@scope/name",
      "version": "1.2.3",
      "integrity": "sha512-<dist.integrity>",
      "sha256": "sha256-<base64 of the downloaded .tgz>",
      "files": { "package/package.json": "sha512-<base64>", "package/index.js": "sha512-<base64>" }
    }
  ]
}
```

That covers an older version of a current member (the immutability law applies if
anyone re-releases that `name@version`) and a name that is no longer a workspace
member (the tag name gives `name@version`, split on the last `@v`), both resolved
through the tagged manifest. The manifest's `private: true` at that commit means
the version was never published, so it is excluded and listed in the report as
`private, never published`. The ledger entry keeps the tag as its key and records
the resolved published name, so the identity check — which looks tags up by
`<name>@v<version>` — is unaffected.

The `files` map is the same digest shape the tag annotations use, so a later
mismatch can name the first differing file. Fetches run four at a time and retry
a transient registry failure (a 5xx or a timeout) three attempts with backoff; a
404 is not transient, but it is not an error either: an exact-version 404 means
the registry never published that `name@version`, so the entry is recorded as
`unpublished` with the metadata URL, the 404 status and the fetch time. That
version is burned — `release plan` refuses a cycle member at it and `release tag`
refuses to create its tag, both `version-burned`. A network failure, a download
whose sha512 does not equal `dist.integrity`, or a tag with zero or several
matching manifests is a hard error: the command exits non-zero, and an adoption
with any error writes no ledger at all.

The report prints one line for each `unpublished` and `mismatched` entry, then
`adopted <N> published, <U> unpublished, <M> mismatched, <E> errors`. A
`mismatched` line names both versions and each version's registry state —
`mismatched <tag>: claims <a> <state>, manifest <b> <state>` — and an error line
is `name@version: <reason>`.

The ledger is one JSON file at the repository root, written by the command and
never hand-edited: keys in a stable order, entries sorted by tag. It lands in its
own commit in the adopting repository, separate from any release commit, so the
adoption itself is a reviewable one-file change. Running `adopt` again keeps
every existing entry, including one whose tag has since left the remote, and
adds only tags the ledger does not hold. A ledger that cannot be read or parsed,
here or at a revision the append-only check reads, stops the command instead of
counting as empty.

After adoption, `release plan` accepts a lightweight tag only when the ledger has
that tag with the same peeled commit and the same `name@version`. A moved tag or
a mismatched entry is a red refusal naming the tag and both commits (or both
values); a ledgered version whose current packed tarball differs from the ledger's
`integrity` is refused with the first differing file, exactly like an annotated
tag. A new lightweight tag that is not in the ledger stays the existing red
refusal, so every tag released after adoption is annotated.

The ledger is append-only. `changeset check <base>` — which already receives the
pull request base revision — fails red when an entry present at the base is
removed or changed at the head; additions are fine. That is what proves the
record was extended rather than rewritten.

### Legacy tags

A repository whose releases predate this tooling and were never published to the
npm registry has no npm bytes to adopt — only its own tags, often a bare
`v<version>`. `adopt` has nothing to record there, and without help the plan
reads the current version as unreleased and owes a second `<name>@v<version>`
tag for it. `legacyTags` names that earlier scheme:

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
`plan-release: legacy release v0.3.6 (<name>@0.3.6), identity not recorded`
for each.

A version above `through` is never matched against the old template, so every
release after adoption is tagged `<name>@v<version>` as usual. A legacy-released
version gets no ledger entry and no integrity check: there are no recorded bytes
to compare against, so the guarantee starts at the first managed release.
