---
"@systemfsoftware/changesets-adapter": minor
"@systemfsoftware/release-language": minor
"@systemfsoftware/version-engine": minor
"@systemfsoftware/changeset-engine": none
"@systemfsoftware/cli-adapter": none
"@systemfsoftware/git-adapter": none
"@systemfsoftware/git-hooks-engine": none
"@systemfsoftware/github-adapter": none
"@systemfsoftware/github-release-engine": none
"@systemfsoftware/process-adapter": none
"@systemfsoftware/workspace-adapter": none
---

`versioning.strategy` is now `"changesets"` in place of `"pnpm"`: `version bump` versions each package from its intents, bumps dependents, writes per-package changelogs and keeps exact inner pins. Configs that set `"pnpm"` must change it to `"changesets"`.
