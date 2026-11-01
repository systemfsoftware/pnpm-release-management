---
"@systemfsoftware/github-adapter": patch
---

`pr` now finds only the open pull request whose head is the release branch in the repository's own owner. It used to treat the first open pull request in the repository as the release PR, because GitHub ignores a head filter that is not written as `owner:branch`, so a repository with any other open pull request had that one renamed, its body replaced, or closed. Now a repository with no release PR gets a new one, and every other pull request is left as it is.
