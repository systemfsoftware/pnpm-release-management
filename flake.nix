{
  description = "pnpm-release-management toolchain — the formatter and runtimes the check chain shells out to";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    comment-checker = {
      url = "github:systemfsoftware/comment-checker";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    importPnpmLock = {
      url = "github:Scrumplex/importPnpmLock.nix/ca18d47b0e98a4b51404f69ce5ab51efb6ebc151";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, comment-checker, importPnpmLock }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      forEachSystem = fn: nixpkgs.lib.genAttrs systems (system: fn nixpkgs.legacyPackages.${system});
      iplFor = system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          iplConfigHook = pkgs.callPackage "${importPnpmLock}/iplConfigHook.nix" {
            mitm-cache = pkgs.callPackage ./nix/mitm-cache.nix { };
          };
        };
    in
    {
      # Every tarball is its own fixed-output fetch keyed by the lockfile's own
      # `integrity`; callers pass no store hash.
      lib.mkPnpmWorkspacePackages = args:
        let
          ipl = iplFor args.pkgs.stdenv.hostPlatform.system;
        in
        (import ./nix/lib/pnpm-workspace-packages.nix) (
          { inherit (ipl) iplConfigHook; } // args
        );

      # The store a consumer's sandbox installs from: the lockfile's registry
      # packages plus the workspace tarballs it names as `file:` dependencies,
      # passed as `files` (directory relative to src -> derivation of *.tgz).
      # `lockFile` is read at evaluation for the registry fetches; pass it apart
      # from src when src is itself a derivation.
      lib.mkPnpmConsumerStore = { pkgs, src, pname ? "consumer", pnpm ? pkgs.pnpm_12, files ? { }, lockFile ? src + "/pnpm-lock.yaml" }:
        (import ./nix/lib/pnpm-store.nix {
          inherit pkgs src pname pnpm files lockFile;
          inherit (iplFor pkgs.stdenv.hostPlatform.system) iplConfigHook;
        }).store;

      packages = forEachSystem (pkgs:
        let
          ipl = iplFor pkgs.stdenv.hostPlatform.system;
          dprint = pkgs.callPackage ./nix/dprint.nix { };
          cc = comment-checker.packages.${pkgs.stdenv.hostPlatform.system}.comment-checker;
          comment-checker-bwrap = pkgs.callPackage ./nix/comment-checker-bwrap.nix { comment-checker = cc; };
          denort = pkgs.callPackage ./nix/denort.nix { };
          sandbox = pkgs.callPackage ./nix/sandbox { };
          workspace = self.lib.mkPnpmWorkspacePackages {
            inherit pkgs;
            src = self;
            pname = "pnpm-release-management";
            pnpm = pkgs.pnpm_11;
          };
          cliApp = appName:
            pkgs.callPackage ./nix/cli-app.nix {
              inherit (pkgs) pnpm_11 nodejs_24 deno;
              inherit (workspace) mitmCache;
              inherit (ipl) iplConfigHook;
              inherit denort;
              src = self;
              inherit appName;
            };
          changeset-management = cliApp "changeset-management";
          version-management = cliApp "version-management";
          github-release-management = cliApp "github-release-management";
          proofs = pkgs.callPackage ./nix/sandbox/proofs.nix {
            inherit pkgs sandbox;
            inherit (ipl) iplConfigHook;
          };
        in workspace // {
          inherit dprint comment-checker-bwrap;
          comment-checker = cc;
          default = dprint;
          inherit sandbox;
          sandbox-proofs = proofs.sandbox-proofs;
          inherit (proofs)
            sandbox-proofs-tiny-store
            sandbox-proofs-tiny-store-bumped
            sandbox-proofs-tampered-store
            sandbox-proofs-consumer-store
            sandbox-proofs-tiny-lib
            ;
          inherit changeset-management version-management github-release-management;
          release-tools = pkgs.symlinkJoin {
            name = "release-tools";
            paths = [ changeset-management version-management github-release-management ];
          };
          git-hooks = cliApp "git-hooks";
        });

      checks = forEachSystem (pkgs:
        let
          system = pkgs.stdenv.hostPlatform.system;
        in
        {
          # A lockfile-only dependency bump needs no hash edit: both stores build
          # from their own lockfile integrities.
          sandbox-proofs-tiny-stores = pkgs.linkFarm "sandbox-proofs-tiny-stores" [
            { name = "pinned"; path = self.packages.${system}.sandbox-proofs-tiny-store; }
            { name = "bumped"; path = self.packages.${system}.sandbox-proofs-tiny-store-bumped; }
          ];

          # An entry under `packages:` with no `resolution:` line must be refused
          # at evaluation time, not disappear into an offline-install fetch
          # error. Fixtures are inline so the check stays pure: no IFD.
          pnpm-lock-parser =
            let
              parser = import ./nix/lib/pnpm-lock.nix { inherit (pkgs) lib; };
              unresolvedFixture = builtins.toFile "pnpm-lock-unresolved.yaml" ''
                lockfileVersion: '9.0'

                packages:

                  left-pad@1.3.0:
                    engines: {node: '>=4'}

                snapshots:

                  left-pad@1.3.0: {}
              '';
              wellFormedFixture = builtins.toFile "pnpm-lock-well-formed.yaml" ''
                lockfileVersion: '9.0'

                packages:

                  ms@2.1.3:
                    resolution: {integrity: sha512-wells-formed-ms-integrity}

                  '@scope/thing@2.0.0':
                    resolution: {integrity: sha512-wells-formed-thing-integrity}

                  local@0.0.0:
                    resolution: {tarball: file:local-0.0.0.tgz}

                snapshots:

                  ms@2.1.3: {}
              '';
              accepted = builtins.tryEval (builtins.deepSeq (parser.tarballCacheData unresolvedFixture) true);
              expectedCache = {
                "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz" = { hash = "sha512-wells-formed-ms-integrity"; };
                "https://registry.npmjs.org/@scope/thing/-/thing-2.0.0.tgz" = {
                  hash = "sha512-wells-formed-thing-integrity";
                };
              };
            in
            pkgs.runCommand "pnpm-lock-parser" { } (
              assert accepted.success == false
                || throw "pnpm-lock.nix: tarballCacheData accepted a package entry with no resolution";
              assert parser.unresolvedPackages unresolvedFixture == [ "left-pad@1.3.0" ]
                || throw "pnpm-lock.nix: unresolvedPackages did not report the entry with no resolution";
              assert parser.tarballCacheData wellFormedFixture == expectedCache
                || throw "pnpm-lock.nix: a well-formed lockfile did not produce the expected tarball cache";
              "touch $out\n"
            );
        });

      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = [
            self.packages.${pkgs.stdenv.hostPlatform.system}.dprint
            (if pkgs.stdenv.hostPlatform.isLinux
              then self.packages.${pkgs.stdenv.hostPlatform.system}.comment-checker-bwrap
              else self.packages.${pkgs.stdenv.hostPlatform.system}.comment-checker)
            self.packages.${pkgs.stdenv.hostPlatform.system}.sandbox
            pkgs.nodejs_24
            pkgs.pnpm_11
            pkgs.deno
          ];
          SANDBOX_PNPM_STORE = self.packages.${pkgs.stdenv.hostPlatform.system}.pnpm-store;
        };
      });
    };
}
