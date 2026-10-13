---
"@systemfsoftware/version-engine": patch
---

`version-management bump` writes each root-changelog bullet as a top-level list item, `- <summary>`, instead of indenting it by two spaces. The release pull request it opens now passes the repository's own `dprint check`.
