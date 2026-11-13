# Sandbox

The sandbox that runs dependency code with nothing it was not given.

`packages.<system>.sandbox` runs dependency code with nothing it was not given:

```bash
sandbox -- pnpm install
sandbox -- pnpm build
sandbox -- pnpm test
sandbox --allow-host api.cloudflare.com --pass-env CLOUDFLARE_API_TOKEN -- pnpm deploy
```

pnpm never reaches a registry from the sandbox. `--pnpm-store` (the dev shell
sets `SANDBOX_PNPM_STORE` to `packages.<system>.pnpm-store`) points pnpm at the
Nix-built store. The sandbox then runs pnpm with `offline`, `frozen-lockfile`,
`ignore-scripts` and `trust-lockfile`; the per-tarball fixed-output fetches
already checked each integrity. pnpm never fetches another pnpm either
(`manage-package-manager-versions` is off), so the launcher refuses a project
whose `packageManager` names a different pnpm major.minor than the one on
`PATH`; a patch-level difference runs with the pnpm provided. Each invocation gets a private copy of the store's index database
that is discarded at exit, so the Nix store stays read-only. `$HOME` is a fresh
tmpfs every time, so nothing a dependency plants survives. Tool caches that
should persist (turbo, vite, `tsbuildinfo`) belong in the project's gitignored
`.cache/`; the sandbox sets `XDG_CACHE_HOME` to it.

| Boundary    | Inside the sandbox                                                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| filesystem  | the project directory read-write, only the invoking closure's store paths readable (`/nix/store` is not listable), an empty `$HOME`, a private `/tmp`; no other home directories |
| environment | cleared, then `PATH`, `TERM`, locale, `TZ`, `CI` and colour settings, plus each `--pass-env`                                                                                     |
| network     | loopback only; each `--allow-host` opens HTTPS to that host through an allow-list proxy; only `--publish` ports reach the host                                                   |
| processes   | own PID, IPC and UTS namespaces, no capabilities, killed with its parent, no controlling terminal                                                                                |

It is bubblewrap (`--unshare-all`, `--cap-drop ALL`, `--die-with-parent`,
`--new-session`) and runs on Linux only. Egress goes through a CONNECT proxy
outside the sandbox that tunnels only to declared `host[:port]` (default 443;
`*.example.com` matches subdomains). Inside, `HTTPS_PROXY` points at it and
`NODE_USE_ENV_PROXY=1` makes Node's `fetch` use it. There is no unsandboxed
mode.

Reads of `/nix/store` are restricted to the invocation's closure: the launcher
resolves `nix-store --query --requisites` over the sandboxed `PATH`, the command
and its own helpers, then mounts each of those paths read-only over an empty
`/nix/store` that cannot be listed. A store path outside the closure is
unreadable, so a dependency cannot enumerate or reach the rest of the store.

`--egress-log PATH` appends one JSONL line per proxy decision, allowed or
refused, at least `{"host","port","decision","rule"}`. The file must sit outside
the sandbox's writable tree — the project, its `$HOME` and its `/tmp` — and the
launcher refuses `PATH` inside them with exit code 2. With `--egress-log` set the
proxy runs and the proxy environment is set even without `--allow-host`, so
refusals are logged too.

`--publish HOST_PORT:SANDBOX_PORT` makes a sandbox port reachable as
`127.0.0.1:HOST_PORT` on the host; only published ports are reachable. On Linux
the sandbox has its own network namespace, so an outside forwarder bridges the
host port to an inside forwarder over a Unix socket. `--listen PORT` declares a
port the stack may bind without publishing it. Both flags take ports 1–65535;
anything malformed exits 2 with usage.

`packages.<system>.sandbox-proofs` is the gate. Each refusal proof first prints
from inside the same sandbox, so a sandbox that fails to start fails the proof
instead of passing it. The proofs: reading `~/.ssh` and `~/.config` fails,
writing outside the project fails, a write to the real `/tmp` leaves nothing on
the host, agent sockets and secrets do not cross the cleared environment, a
store path outside the closure and the listing of `/nix/store` both fail while a
closure tool still runs and an offline `pnpm` 12 install of a tiny workspace
resolves from the `--pnpm-store` store, a consumer installs a `file:` workspace
tarball from its `mkPnpmConsumerStore` store while a store without that tarball
fails, a `packageManager` pin on another pnpm minor is refused while one on
another patch installs offline (and fails once pnpm manages its version),
`--egress-log` records exactly the
allowed and refused decisions and refuses a log inside the project, an
undeclared connection fails, a declared host is reachable while every other host
is refused, a loopback dev server still answers, and a published port answers
from the host while an unpublished one does not. CI runs them on Linux, then
installs, builds and tests this repository as three separate sandbox
invocations with no network at all.

bubblewrap needs unprivileged user namespaces and a mountable `/proc`. Ubuntu
24.04 needs `sysctl kernel.apparmor_restrict_unprivileged_userns=0`. A
container needs `/proc` unmasked (`--security-opt unmask=/proc/*` under
podman). Without them the sandbox refuses to start.
