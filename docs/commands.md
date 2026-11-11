# Commands

Every app subcommand and its flags.

| App subcommand      | What it does                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `changeset check`   | Fails when a publishable package changed without an intent naming it; lists deleted packages, which need none |
| `changeset new`     | Writes an intent file                                                                                         |
| `version bump`      | Consumes intents, bumps every surface, writes per-package changelogs                                          |
| `version sync`      | `check` or `bump <version>` across every declared surface                                                     |
| `version sync-root` | Stamps the launcher manifest with the released version                                                        |
| `release pr`        | Commits the bumped tree to the release branch, opens, refreshes, or closes the release PR                     |
| `release adopt`     | Records every pre-adoption release tag's bytes in the adoption ledger                                         |
| `release plan`      | Derives the release phase from repository state                                                               |
| `release tag`       | Captures the cycle, then pushes one tag per released package                                                  |
| `release release`   | Creates GitHub Releases from the generated changelogs                                                         |
| `hooks pre-commit`  | Formats and checks the staged set before a commit lands                                                       |
| `hooks commit-msg`  | Enforces the conventional-commit header and strips AI co-author trailers                                      |

Every subcommand takes `--config <path>` and otherwise loads `release.jsonc` from
the directory it is run in. The flag may name either the workspace root or a file
inside it: a directory is taken as the root, a file path means its directory is.

Flags worth knowing:

| App subcommand      | Flags                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `changeset check`   | `<base-sha-or-ref>`, `--base`, `--skip-liveness`                                              |
| `release plan`      | `--output <file>`, `--deferred <file>`, `--remote <name>`                                     |
| `release adopt`     | `--registry <url>`, `--output <file>`, `--remote <name>`                                      |
| `release tag`       | `--captured <file>`, `--output <file>`, `--exclude`, `--json`, `--dry-run`, `--remote <name>` |
| `release release`   | `--captured <file>`, `--assert`, `--dry-run`                                                  |
| `version sync`      | `check \| bump <version>`                                                                     |
| `version sync-root` | `--manifest <path>`, `--version <version>`, `--dry-run`                                       |

`--output` on `release tag` captures the cycle _and_ skips pushing: the workflow
captures once, then hands the same file to tagging and the release step so both
agree on what this cycle owns.
