{
  description = "pnpm-release-management toolchain — the formatter and runtimes the check chain shells out to";

  nixConfig = {
    extra-substituters = "https://nix.systemfsoftware.com";
    extra-trusted-public-keys = "nix-cache-1:wXA8I4DayNW9q6enUyQA/P/nT38pGSTLt374t3gsn7M=";
  };

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
      systems = [ "x86_64-linux" "aarch64-linux" ];
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

      # The store a consumer's sandbox installs from: the lockfile's registry
      # packages plus the workspace tarballs it names as `file:` dependencies,
      # passed as `files` (directory relative to src -> derivation of *.tgz).
      # `lockFile` and `workspaceFile` are read at evaluation; pass them apart
      # from src when src is itself a derivation.
      lib.mkPnpmConsumerStore = { pkgs, src, pname ? "consumer", pnpm ? pkgs.pnpm_12, files ? { }, lockFile ? src + "/pnpm-lock.yaml", workspaceFile ? if pkgs.lib.isDerivation src then null else src + "/pnpm-workspace.yaml" }:
        (import ./nix/lib/pnpm-store.nix {
          inherit pkgs src pname pnpm files lockFile workspaceFile;
          inherit (iplFor pkgs.stdenv.hostPlatform.system) iplConfigHook;
        }).store;

      # The tarballs of producer flakes, whole, for a consumer's `files` and its
      # host install. No package is named by hand: see README, "Take a
      # producer's packages".
      lib.mkProducerTarballs = args: import ./nix/lib/producer-tarballs.nix args;

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

          # pnpm accepts a `dir/*` glob whose directory does not exist yet, so
          # the builder must too, and still find the public members elsewhere.
          # A workspace with no public member packs nothing and installs
          # nothing: its pnpm pin (never installable here) is not consulted.
          workspace-globs =
            let
              members = (self.lib.mkPnpmWorkspacePackages {
                inherit pkgs;
                src = ./nix/lib/fixtures/missing-glob-parent;
                pname = "missing-glob-parent";
              }).workspace-tarballs.passthru.members;
              privateOnly = (self.lib.mkPnpmWorkspacePackages {
                inherit pkgs;
                src = ./nix/lib/fixtures/private-only;
                pname = "private-only";
              }).workspace-tarballs;
            in
            pkgs.runCommand "workspace-globs" { nativeBuildInputs = [ pkgs.jq ]; } (
              assert map (e: e.name) members == [ "@fixture/web" ]
                || throw "pnpm-workspace-packages.nix: expected only @fixture/web from apps/* with packages/ absent";
              ''
                jq -e '. == []' ${privateOnly}/index.json
                touch $out
              ''
            );

          # A member depending on a `file:` tarball packs only when the tarball
          # is laid into src where the lockfile names it.
          workspace-file-deps =
            let
              tarballs = (self.lib.mkPnpmWorkspacePackages {
                inherit pkgs;
                src = ./nix/lib/fixtures/file-deps;
                pname = "file-deps";
                files.".deps" = self.packages.${system}.sandbox-proofs-tiny-lib;
              }).workspace-tarballs;
            in
            pkgs.runCommand "workspace-file-deps" { nativeBuildInputs = [ pkgs.jq ]; } ''
              jq -e '. == [{ name: "@fixture/app", file: "app-1.0.0.tgz" }]' ${tarballs}/index.json
              touch $out
            '';

          # A build from a lockfile cut down to some members installs only that
          # lockfile's importers with the dependencies it records, builds, and
          # packs only the members asked for, each with its manifest from src.
          # The full lockfile needs a tarball this build is never given. pnpm
          # 11 reinstalls before `pnpm run` when a manifest differs from the
          # install, which offline fails.
          workspace-lockfile-members =
            let
              tarballs = (self.lib.mkPnpmWorkspacePackages {
                inherit pkgs;
                src = ./nix/lib/fixtures/lockfile-members;
                pname = "lockfile-members";
                pnpm = pkgs.pnpm_11;
                members = [ "@fixture/wanted" ];
                lockFile = ./nix/lib/fixtures/lockfile-members/cut/pnpm-lock.yaml;
              }).workspace-tarballs;
            in
            pkgs.runCommand "workspace-lockfile-members" { nativeBuildInputs = [ pkgs.jq ]; } ''
              jq -e '. == [{ name: "@fixture/wanted", file: "wanted-1.0.0.tgz" }]' ${tarballs}/index.json
              [ "$(ls ${tarballs})" = "$(printf 'index.json\nwanted-1.0.0.tgz')" ]
              tar -xOzf ${tarballs}/wanted-1.0.0.tgz package/package.json \
                | jq -e '.devDependencies == { "@sandbox-proof/tiny-lib": "file:../../.deps/tiny-lib-1.0.0.tgz" }'
              touch $out
            '';

          # A consumer takes producer flakes whole. Each package lands under a
          # file name with no version, `index.json` lists them, and `overrides`
          # is the block a consumer's pnpm-workspace.yaml carries. Two producers
          # shipping one package are refused unless `precedence` orders them.
          producer-tarballs =
            let
              fake = members: {
                packages.${system}.workspace-tarballs = pkgs.lib.extendDerivation true { inherit members; }
                  (pkgs.runCommand "fake-tarballs" { } ''
                    mkdir "$out"
                    ${pkgs.lib.concatMapStrings (m: "echo ${m.name} > \"$out\"/${m.tarball}\n") members}
                  '');
              };
              real = {
                packages.${system}.workspace-tarballs = (self.lib.mkPnpmWorkspacePackages {
                  inherit pkgs;
                  src = ./nix/lib/fixtures/file-deps;
                  pname = "file-deps";
                  files.".deps" = self.packages.${system}.sandbox-proofs-tiny-lib;
                }).workspace-tarballs;
              };
              other = fake [
                { name = "@other/app"; attr = "app"; tarball = "app-2.0.0.tgz"; }
                { name = "@other/lib"; attr = "lib"; tarball = "lib-3.0.0.tgz"; }
              ];
              only = self.lib.mkProducerTarballs { inherit pkgs; producers = { inherit real; }; };
              merged = self.lib.mkProducerTarballs {
                inherit pkgs;
                producers = { inherit real other; };
                precedence = [ "real" "other" ];
              };
              reversed = self.lib.mkProducerTarballs {
                inherit pkgs;
                producers = { inherit real other; };
                precedence = [ "other" "real" ];
              };
              clash = builtins.tryEval (self.lib.mkProducerTarballs { inherit pkgs; producers = { inherit real other; }; }).drvPath;
            in
            assert clash.success == false
              || throw "mkProducerTarballs: two producers shipping `app` were accepted without precedence";
            assert only.overrides == "  \"@fixture/app@*\": file:.deps/app.tgz\n"
              || throw "mkProducerTarballs: overrides is not one version-free `name@*` file: entry per package";
            assert merged.overrides == "  \"@fixture/app@*\": file:.deps/app.tgz\n  \"@other/lib@*\": file:.deps/lib.tgz\n"
              || throw "mkProducerTarballs: a package two producers ship appears once";
            pkgs.runCommand "producer-tarballs" { nativeBuildInputs = [ pkgs.jq ]; } ''
              [ "$(ls ${only})" = "$(printf 'app.tgz\nindex.json')" ]
              jq -e '. == [{ file: "app.tgz", name: "@fixture/app" }]' ${only}/index.json
              cmp ${only}/app.tgz ${real.packages.${system}.workspace-tarballs}/app-1.0.0.tgz

              [ "$(ls ${merged})" = "$(printf 'app.tgz\nindex.json\nlib.tgz')" ]
              cmp ${merged}/app.tgz ${real.packages.${system}.workspace-tarballs}/app-1.0.0.tgz
              jq -e '. == [{ file: "app.tgz", name: "@fixture/app" }, { file: "lib.tgz", name: "@other/lib" }]' ${merged}/index.json
              [ "$(cat ${reversed}/app.tgz)" = "@other/app" ]

              mkdir consumer && cd consumer
              echo stale > old.tgz && mkdir .deps && cp old.tgz .deps/old.tgz
              ${only.shellHook}
              [ -f .deps/app.tgz ] && [ ! -L .deps/app.tgz ] && [ -f .deps/index.json ] && [ ! -e .deps/old.tgz ]
              cmp .deps/app.tgz ${only}/app.tgz
              touch $out
            '';

          # The consumer route end to end: a lockfile that names
          # `file:.deps/tiny-lib.tgz` installs from the store built with the
          # producer's tarballs, and its pnpm-workspace.yaml is the generated
          # overrides block.
          producer-consumer-store =
            let
              producer.packages.${system}.workspace-tarballs = pkgs.lib.extendDerivation true
                { members = [{ name = "@sandbox-proof/tiny-lib"; attr = "tiny-lib"; tarball = "tiny-lib-1.0.0.tgz"; }]; }
                self.packages.${system}.sandbox-proofs-tiny-lib;
              tarballs = self.lib.mkProducerTarballs { inherit pkgs; producers = { inherit producer; }; };
            in
            assert builtins.readFile ./nix/lib/fixtures/producer-consumer/pnpm-workspace.yaml == "overrides:\n${tarballs.overrides}"
              || throw "producer-consumer fixture: pnpm-workspace.yaml is not the generated overrides block";
            self.lib.mkPnpmConsumerStore {
              inherit pkgs;
              src = ./nix/lib/fixtures/producer-consumer;
              pname = "producer-consumer";
              pnpm = pkgs.pnpm_12;
              files.".deps" = tarballs;
            };
        });

      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = [
            self.packages.${pkgs.stdenv.hostPlatform.system}.dprint
            self.packages.${pkgs.stdenv.hostPlatform.system}.comment-checker-bwrap
            self.packages.${pkgs.stdenv.hostPlatform.system}.sandbox
            self.packages.${pkgs.stdenv.hostPlatform.system}.release-tools
            pkgs.nodejs_24
            pkgs.pnpm_11
            pkgs.deno
          ];
          SANDBOX_PNPM_STORE = self.packages.${pkgs.stdenv.hostPlatform.system}.pnpm-store;
        };
      });
    };
}
