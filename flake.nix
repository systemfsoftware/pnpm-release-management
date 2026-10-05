{
  description = "pnpm-release-management toolchain — the formatter and runtimes the check chain shells out to";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    comment-checker = {
      url = "github:systemfsoftware/comment-checker";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, comment-checker }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forEachSystem = fn: nixpkgs.lib.genAttrs systems (system: fn nixpkgs.legacyPackages.${system});
    in
    {
      packages = forEachSystem (pkgs:
        let
          dprint = pkgs.callPackage ./nix/dprint.nix { };
          cc = comment-checker.packages.${pkgs.stdenv.hostPlatform.system}.comment-checker;
          comment-checker-bwrap = pkgs.callPackage ./nix/comment-checker-bwrap.nix { comment-checker = cc; };
          denort = pkgs.callPackage ./nix/denort.nix { };
          cliApp = appName:
            pkgs.callPackage ./nix/cli-app.nix {
              inherit (pkgs) pnpm_11 nodejs_24 deno;
              inherit denort;
              src = self;
              inherit appName;
            };
        in {
          inherit dprint comment-checker-bwrap;
          comment-checker = cc;
          default = dprint;
          changeset-management = cliApp "changeset-management";
          version-management = cliApp "version-management";
          github-release-management = cliApp "github-release-management";
          git-hooks = cliApp "git-hooks";
        });

      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = [
            self.packages.${pkgs.stdenv.hostPlatform.system}.dprint
            self.packages.${pkgs.stdenv.hostPlatform.system}.comment-checker-bwrap
            pkgs.nodejs_24
            pkgs.pnpm
            pkgs.deno
          ];
        };
      });
    };
}
