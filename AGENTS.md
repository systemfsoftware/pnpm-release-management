# AGENTS.md

- A launcher change counts as done only when its darwin path has run a real offline pnpm install in CI. Gate: review — the PR's `sandbox proofs · macos-latest` job passed its step "Install through the sandbox, offline from the Nix pnpm store". Wrong: merging on green Linux proofs while the macOS job failed earlier. Right: linking the green macOS run of that step.
