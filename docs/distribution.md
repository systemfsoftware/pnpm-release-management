# Distribution through Nix

Producing and consuming `@systemfsoftware` package tarballs through the Nix registry. The short consumer route is in the [README](../README.md#distribution-through-nix).

https://nix.systemfsoftware.com is the package registry for `@systemfsoftware`
packages: a producer pushes its package tarballs there from `main`, a consumer
substitutes them through its flake inputs, and nothing is published to npm.

The registry is the org's Nix binary cache on Cloudflare R2. A tarball is a Nix
store path, so a consumer whose producer has pushed it fetches the bytes and
builds nothing.

### Produce

A repository ships its public workspace packages as flake outputs. One call in
`flake.nix`:

```nix
packages = forEachSystem (pkgs:
  pnpm-release-management.lib.mkPnpmWorkspacePackages {
    inherit pkgs;
    src = self;
  });
```

For every member of `pnpm-workspace.yaml` that is not `private`, this gives
`packages.<system>.<name>`: the member's `pnpm pack` tarball, with the scope
dropped from the name. It also gives `packages.<system>.workspace-tarballs`:
every tarball plus an `index.json` of `{ name, file }`.

- Third-party tarballs enter as one fixed-output fetch per tarball, keyed by the
  `integrity` the lockfile already records, so a lockfile bump needs no hash
  edit. `nix/lib/pnpm-lock.nix` reads the lockfile's `packages:` map in pure Nix
  (a parsing derivation would import from a derivation for the target system,
  which breaks `nix eval .#devShells.<other-system>`); a plain derivation then
  runs pnpm offline through the `importPnpmLock` input's config hook and
  assembles `packages.<system>.pnpm-store`, the store directory pnpm installs
  from with no npm registry. `file:` tarballs and `directory` entries are
  workspace-local and are skipped before any fetch.
- Install runs with `--ignore-scripts` in the Nix sandbox. The members build
  with their `build` script (`buildScript` overrides it), then `pnpm pack`
  writes each tarball and turns every `workspace:` range into the exact version.
- The tarballs rebuild bit-for-bit. CI proves it with
  `nix build --rebuild .#workspace-tarballs`. A declaration file that prints an
  inferred union breaks this, because TypeScript 7 orders union members
  differently from run to run (microsoft/TypeScript#64589). Annotate such an
  export with a named type.
- `pnpm` defaults to `pkgs.pnpm_12`. The root `packageManager` must pin exactly
  that version, or evaluation fails: one pnpm resolves everywhere.
- `packages.<system>.pnpm-store` is that store directory, in the layout
  `sandbox --pnpm-store` consumes.
- `members` (package names) limits the build and the packed tarballs to those
  public members; an unknown or private name fails evaluation.
- `lockFile` builds the tarballs from a lockfile cut down from the workspace's,
  so a cold build fetches only what the packed members need. Write it with
  `pnpm install --lockfile-only` in a copy of the workspace whose manifests keep
  only those members, the workspace packages they reach and the dependencies
  their builds use; starting from `pnpm-lock.yaml`, pnpm keeps every version it
  pins. The build drops the workspace projects that lockfile has no importer
  for, installs each importer with exactly the dependencies it records and
  builds, then restores the manifests, so each tarball packs its own
  `package.json`.
  `pnpm-store` still installs the whole workspace from `pnpm-lock.yaml`. Check
  the cut lockfile in CI by writing it again and diffing, or it drifts.

The producer's `main` workflow pushes `packages.<system>.workspace-tarballs` and
`packages.<system>.<name>` of every public member, signed with the cache's key
`nix-cache-1`. `nix eval --json .#workspace-tarballs.members --apply 'map (member:
member.attr)'` lists the names, so the push set is not kept by hand. A consumer
gets a hit only on the store path its own evaluation computes, so build the push
set from the flake reference consumers pin, `github:<owner>/<repo>/<rev>`.

### Take a producer's packages

A consumer sets the registry as a substituter and takes each producer as a flake
input pinned by `flake.lock`. A pull request's head revision is a snapshot, and
a release tag is a stable version:

```nix
{
  nixConfig = {
    extra-substituters = "https://nix.systemfsoftware.com";
    extra-trusted-public-keys = "nix-cache-1:wXA8I4DayNW9q6enUyQA/P/nT38pGSTLt374t3gsn7M=";
    fallback = true;
  };

  inputs = {
    nixpkgs.follows = "producer/nixpkgs";
    producer.url = "github:systemfsoftware/systemfsoftware/<rev>";
    pnpm-release-management.url = "github:systemfsoftware/pnpm-release-management";
  };
}
```

Only the consuming flake's `nixConfig` applies, and Nix honours it only with
`--accept-flake-config` or for a trusted user; otherwise it prints `ignoring
untrusted flake configuration setting 'extra-substituters'` and builds from
source. The same three lines go in `nix.conf`, and in `extra_nix_config` of
`cachix/install-nix-action` for CI. `fallback = true` builds a missing path
instead of failing. A producer input carries no `follows`: `workspace-tarballs`
is input-addressed, so a producer evaluated against another `nixpkgs` or another
`pnpm-release-management` has another store path than the one it pushed, and the
consumer builds it. The consumer follows one producer instead
(`nixpkgs.follows = "producer/nixpkgs"`); a second producer keeps its own
inputs.

`lib.mkProducerTarballs` takes the producers whole, so no package is named by
hand:

```nix
packages = forEachSystem (pkgs: rec {
  producer-tarballs = pnpm-release-management.lib.mkProducerTarballs {
    inherit pkgs;
    producers = { inherit producer; }; # each: packages.<system>.workspace-tarballs
  };
  pnpm-store = pnpm-release-management.lib.mkPnpmConsumerStore {
    inherit pkgs;
    src = self; # holds package.json, pnpm-lock.yaml, pnpm-workspace.yaml
    files.".deps" = producer-tarballs;
  };
});

devShells = forEachSystem (pkgs: {
  default = pkgs.mkShell {
    shellHook = self.packages.${pkgs.stdenv.hostPlatform.system}.producer-tarballs.shellHook;
  };
});
```

`producer-tarballs` holds one `<name>.tgz` for every public member of every
producer, with the scope and the version dropped from the name, and an
`index.json` of `{ name, file }`. Because no file name carries a version, moving
a producer changes no path in the consumer's manifests. Two producers that ship
one name are an evaluation error until `precedence = [ "first" "second" ]`
orders them; the first wins. The tarballs sit in `.deps/` under the consumer's
root; add it to `.gitignore`.

A producer's packages name each other by exact version, so each one is
overridden to its tarball or pnpm would look it up on npm. `overrides` is that
block, written once and rewritten only when a producer adds or drops a package.
Each key is `<name>@*`, which leaves a workspace member of the same name linked:
a bare name would replace it with the producer's tarball.

```sh
nix eval --raw .#producer-tarballs.overrides
```

```yaml
overrides:
  "@systemfsoftware/effect-cell-types@*": file:.deps/effect-cell-types.tgz
```

Entering the dev shell runs `shellHook`, which copies the tarballs into `.deps/`
of the git root it is entered from, as real files, and removes the ones it left
before: the sandbox reads no store path outside its closure, so a symlink into
the store would not install. Enter the shell from the consumer's checkout.

Moving a version is one step: `nix flake update producer`. The next dev shell
copies the new bytes, and `pnpm update '@systemfsoftware/*'` rewrites each
entry's `version` and `integrity` in `pnpm-lock.yaml`. Until then a cold `pnpm
install --frozen-lockfile` fails with `ERR_PNPM_TARBALL_INTEGRITY`; an install
over an existing `node_modules` is not cold, and keeps the files it has.

`nix build --dry-run .#producer-tarballs` shows what a cold install would build.
A producer path under "will be built" is one the producer has not pushed.

Old versions of some `@systemfsoftware` packages still exist on npm, so an
entry missing from `overrides` installs one of them and the install stays green.
After `pnpm update`, check that no `@systemfsoftware/*` entry of
`pnpm-lock.yaml` has a `resolution` without `tarball: file:.deps/`.

The consumer's sandbox installs from one store holding both its npm packages and
those tarballs. A store with only the npm packages fails the install: pnpm tries
to add the tarball to the read-only store. `lib.mkPnpmConsumerStore` builds it,
as above.

`files` maps a directory relative to `src` to a derivation holding the
`*.tgz` the lockfile names there. Third-party tarballs come from per-tarball
fixed-output fetches as above; the `pnpm` and `@pnpm/exe.*` entries of pnpm
12's env document are skipped, because the sandbox never lets pnpm fetch
itself.

The store reads `supportedArchitectures` from `pnpm-workspace.yaml` and fetches
optional npm packages for all configured OS, CPU and libc values.
Required packages are retained regardless of platform. `current` refers to the
platform running pnpm. Unrestricted or unrecognized platform settings are
kept rather than excluded. If `src` is a derivation, pass an evaluation-readable
`workspaceFile` separately; otherwise the builder keeps all npm packages
when it cannot read the workspace configuration. `lockFile` can likewise be
passed separately from a derivation-backed `src`.

A workspace that publishes its own packages and also consumes tarballs this way
passes the same `files` to `lib.mkPnpmWorkspacePackages`. Its tarball build
installs from the lockfile too, so without them the build fails on the first
`file:` path it cannot open.

Resolving the lockfile is the one step that runs on the host: `pnpm install
--lockfile-only` needs npm registry metadata, which no store carries. It reads
metadata only and runs no package code. Every install, build and test after it
runs in the sandbox.
