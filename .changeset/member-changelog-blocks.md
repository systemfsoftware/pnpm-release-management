---
"@systemfsoftware/changesets-adapter": patch
---

`version-management bump` keeps each intent a separate block in a member changelog, with a blank line between intents, instead of joining their markdown with a space. A list in one intent no longer fuses into the paragraph before it, so the changelog passes the repository's own `dprint check`.
