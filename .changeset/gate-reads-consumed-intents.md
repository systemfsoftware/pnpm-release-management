---
"@systemfsoftware/changeset-engine": patch
"@systemfsoftware/release-language": patch
"@systemfsoftware/workspace-adapter": patch
"@systemfsoftware/process-adapter": patch
---

The intent check decides a change from the change itself: a deleted intent whose packages only gain a version bump and changelog entry is that move's intent, so a release PR passes on a merge-queue draft branch, and a move with no intent to consume is still refused.
