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
