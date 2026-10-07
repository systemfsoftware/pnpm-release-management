# AGENTS.md

- A launcher change counts as done only when it has run a real offline pnpm install in CI. Gate: review — the PR's `sandbox proofs` job passed its step "Install through the sandbox, offline from the Nix pnpm store".
