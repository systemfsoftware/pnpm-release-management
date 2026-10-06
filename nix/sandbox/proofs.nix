{
  lib,
  pkgs,
  writeShellApplication,
  sandbox,
  coreutils,
  curl,
  git,
  gnugrep,
  hello,
  nodejs_24,
  nix,
  pnpm_12,
  iplConfigHook,
}:
let
  tinyWorkspace = builtins.path {
    path = ./tiny-workspace;
    name = "sandbox-proofs-tiny-workspace";
  };

  storeOf = name: fixture: (import ../lib/pnpm-store.nix {
    inherit pkgs iplConfigHook;
    pnpm = pnpm_12;
    pname = "sandbox-proofs-${name}";
    src = builtins.path { path = fixture; name = "sandbox-proofs-${name}-workspace"; };
  }).store;

  tinyStore = storeOf "tiny" ./tiny-workspace;
  bumpedStore = storeOf "bumped" ./tiny-workspace-bumped;
  # The lockfile records the real ms 2.1.3 entry with a wrong integrity: building
  # this store must fail red on a hash mismatch.
  tamperedStore = storeOf "tampered" ./tiny-workspace-tampered;

  substitutions = {
    outsider = "${hello}";
    pnpm12Version = pnpm_12.version;
    tinyStore = "${tinyStore}";
    tinyWorkspace = "${tinyWorkspace}";
  };
in
{
  sandbox-proofs = writeShellApplication {
    name = "sandbox-proofs";
    runtimeInputs = [ sandbox coreutils curl git gnugrep nodejs_24 nix pnpm_12 ];
    text = lib.replaceStrings
      (map (name: "@${name}@") (builtins.attrNames substitutions))
      (map toString (builtins.attrValues substitutions))
      (builtins.readFile ./proofs.sh);
    excludeShellChecks = [ "SC2016" ];
  };

  sandbox-proofs-tiny-store = tinyStore;
  sandbox-proofs-tiny-store-bumped = bumpedStore;
  sandbox-proofs-tampered-store = tamperedStore;
}
