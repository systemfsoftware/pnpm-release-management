# Change intents

How a pull request records the release it causes: one Markdown intent per change, written with `changeset new`.

An intent is a Markdown file in `.changeset/` whose frontmatter names the
packages it changes and with which bump, and whose body is the release note.

```markdown
---
"@scope/alpha": minor
"@scope/beta": none
---

Alpha grows a public export.
```

Author one with `changeset new` rather than by hand:

```bash
node apps/changeset-management/dist/main.js new @scope/alpha --bump minor \
  --summary "Alpha grows a public export"
```

`none` consumes an intent without moving a version — use it for work that must
be recorded but does not ship. `version bump` deletes every intent it consumes,
so the release PR diff _is_ the set of notes that shipped. `release pr` runs
after `version bump` and commits the tree bump left: changes to tracked files
open or refresh the release PR, an unchanged tree closes it, and an intent still
on disk means bump has not run, so `pr` refuses instead of reporting nothing to
release. The release commit holds the tracked changes plus the changelogs bump
created; any other untracked file, such as a `.release/` artifacts directory,
neither opens the release PR nor rides into its commit. The release commit is
authored and committed as `github-actions[bot]
<41898282+github-actions[bot]@users.noreply.github.com>`, passed to that one
`git commit` with `-c`, so `pr` needs no git identity on the runner and changes
no git config.

## How `changeset check` reads a pull request

The check runs on every pull request, the release PR and merge-queue drafts
included; it never looks at the branch name. It reads the commits between the
merge base and `HEAD` one at a time.

- A commit that deletes intents present at the merge base and adds or edits
  none is a release candidate. The check replays it: it checks out the commit's
  parent in a temporary worktree, sets aside the intents the commit did not
  delete, runs the same `version bump`, stages the result the way `release pr`
  does and compares the tree. An exact match is a verified release commit, and
  the paths it touched need no new intent. Any other difference refuses the
  check and names each path, so a manifest edit, a dropped sibling release or
  an extra file cannot ride in a release commit.
- A release commit cut from an older base is refused when the base has since
  changed `release.jsonc`, `pnpm-workspace.yaml`, any `package.json`, a version
  surface `release.jsonc` names, or a non-intent file in the changeset
  directory; regenerate the release. Commits between the base and the release
  commit's parent belong to the change itself and do not make it stale.
- Every other changed path belongs to the feature. Each publishable package
  that owns one (the deepest member directory wins) needs a live intent naming
  it, `none` included. A merge commit's own edits, beyond merging its parents,
  count as feature changes. A two-parent merge whose parents share no ancestor
  — a first `git subtree add --squash`, whose second parent is a parentless
  squash commit — has no merge base to compare against, so its own edits are
  every path that differs between its first parent and the merge commit.
- Intent edits may split, merge, move or rewrite intents, but each package must
  keep at least the highest bump that the merge-base intents changed or deleted
  here still owed it, unless a verified release commit consumed them. Moving
  the changeset directory carries every pending intent: each one at the old
  directory still owes its bump.
- Under the `turbo` gate a package whose task hash moved without it owning a
  changed path passes when every moved task it depends on is accounted for
  (named, released, or itself accounted for) and no feature-changed file
  reaches its hash as a global or task input.

The check needs the full history (`fetch-depth: 0`); a shallow clone is
refused.
