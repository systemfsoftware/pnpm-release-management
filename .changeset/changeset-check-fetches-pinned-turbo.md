---
"@systemfsoftware/process-adapter": major
---

Under `"gate": { "strategy": "turbo" }` the change evidence now fetches the `@turbo/<os>-<arch>` package the root importer pins in `pnpm-lock.yaml`, checks its bytes against the integrity the lockfile records, requires the fetched binary to print the pinned version and runs it with telemetry off, instead of executing `node_modules/.bin/turbo`. A verdict therefore needs no installed workspace.

Breaking for adapter authors: `ChangeEvidenceLive` now requires `RegistryPort`. The refusal details that named a missing or mismatched installed binary, and the install that fixed them, give way to fetch-bound ones: a platform with no published binary, a lockfile entry with no integrity, a tarball that cannot be fetched, bytes that do not match, a tarball holding no `bin/turbo`, a binary reporting a version other than the pin — all under the unchanged `turbo pin unusable:` stem.
