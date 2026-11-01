---
"@systemfsoftware/process-adapter": major
---

Under the `turbo` gate strategy, change evidence now fetches the `@turbo/<os>-<arch>` package the lockfile pins, from the lockfile's tarball URL or the public npm registry. It checks the bytes against the recorded integrity, requires the binary to print the pinned version, and runs it with telemetry off. A verdict needs no installed workspace, only that registry.

Breaking for adapter authors: `ChangeEvidenceLive` requires `RegistryPort`; provide the adoption adapter's `RegistryLive` over an HTTP client. Install-bound refusal details become fetch-bound ones under the unchanged `turbo pin unusable:` stem: no published binary, no recorded integrity, an unfetchable tarball, mismatched bytes, no `bin/turbo`, or a version other than the pin. A failed dry run names `turbo (<package>@<pin>)`.
