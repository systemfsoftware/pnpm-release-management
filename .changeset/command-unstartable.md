---
"@systemfsoftware/release-language": major
"@systemfsoftware/workspace-adapter": minor
---

When `pnpm` cannot be started, the release tools now report `pnpm could not be started: ENOENT (...)` instead of `manifest-unreadable` at the repository root. A manifest that really cannot be read is still reported as `ManifestUnreadable` at its path.

Breaking for adapter authors: `MemberRefusal` gains `CommandUnstartable { command, reason }`, so exhaustive matches over it need a new case.
