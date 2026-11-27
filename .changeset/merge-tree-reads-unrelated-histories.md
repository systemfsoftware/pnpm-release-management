---
"@systemfsoftware/process-adapter": patch
---

`changeset check` reads a first-time squashed subtree add instead of crashing on it. When a two-parent merge's parents share no ancestor, its own edits are every path that differs between its first parent and the merge commit; a merge whose parents are related keeps its `git merge-tree` residue unchanged.
