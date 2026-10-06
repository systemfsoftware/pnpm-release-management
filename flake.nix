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
      iplFor = system: importPnpmLock.legacyPackages.${system};
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
