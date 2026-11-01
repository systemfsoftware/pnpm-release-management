---
"@systemfsoftware/adoption-adapter": minor
"@systemfsoftware/github-release-engine": minor
"@systemfsoftware/release-language": minor
"@systemfsoftware/git-adapter": minor
---

New `release adopt` records the published bytes of every release tag that predates tarball identity in an append-only adoption ledger, and `release plan` refuses to plan when a pre-adoption release no longer matches its ledger entry. A tag whose version was never published is recorded as burned, and an unreadable ledger is refused.
