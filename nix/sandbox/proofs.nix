{
  lib,
  writeShellApplication,
  sandbox,
  coreutils,
  curl,
  fetchPnpmDeps,
  git,
  gnugrep,
  hello,
  nodejs_24,
  nix,
  pnpm_12,
  runCommand,
  stdenv,
  sqlite,
  zstd,
}:
let
  tinyWorkspace = builtins.path {
    path = ./tiny-workspace;
    name = "sandbox-proofs-tiny-workspace";
  };

  tinyPnpmDeps = fetchPnpmDeps {
    pname = "sandbox-proofs-tiny";
    src = tinyWorkspace;
    pnpm = pnpm_12;
    version = "0";
    fetcherVersion = 4;
    hash = {
      aarch64-darwin = "sha256-Xh+Jg4NCc3KdjUa7eeM32eBflia23A8WAnlUefTpEpM=";
    }.${stdenv.hostPlatform.system} or "sha256-y/blOFRltaSI2RwGdaA0e+JJZJApsac82L4lJ2MFrRM=";
  };

  tinyStore = runCommand "sandbox-proofs-tiny-store" { nativeBuildInputs = [ sqlite zstd ]; } ''
    mkdir -p "$out"
    tar --zstd -xf ${tinyPnpmDeps}/pnpm-store.tar.zst -C "$out"
    chmod -R u+w "$out"
    for dump in "$out"/v*/index.db.sql; do
      [ -e "$dump" ] || continue
      sqlite3 "''${dump%.sql}" < "$dump"
      rm "$dump"
    done
  '';

  substitutions = {
    outsider = "${hello}";
    pnpm12Version = pnpm_12.version;
    tinyStore = "${tinyStore}";
    tinyWorkspace = "${tinyWorkspace}";
  };
in
writeShellApplication {
  name = "sandbox-proofs";
  runtimeInputs = [ sandbox coreutils curl git gnugrep nodejs_24 nix pnpm_12 ];
  text = lib.replaceStrings
    (map (name: "@${name}@") (builtins.attrNames substitutions))
    (map toString (builtins.attrValues substitutions))
    (builtins.readFile ./proofs.sh);
  excludeShellChecks = [ "SC2016" ];
}
