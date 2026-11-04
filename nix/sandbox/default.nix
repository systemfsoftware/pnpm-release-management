{ lib, writeShellApplication, bubblewrap, socat, nodejs_24, cacert, coreutils, git, bash, nix, pnpm_12 }:
let
  substitutions = {
    node = lib.getExe nodejs_24;
    egressProxy = builtins.path { path = ./egress-proxy.mjs; name = "egress-proxy.mjs"; };
    caBundle = "${cacert}/etc/ssl/certs/ca-bundle.crt";
    bwrap = lib.getExe bubblewrap;
    socat = lib.getExe socat;
    sh = lib.getExe bash;
    sleep = "${coreutils}/bin/sleep";
    nixStore = lib.getExe' nix "nix-store";
  };
in
writeShellApplication {
  name = "sandbox";
  runtimeInputs = [ coreutils git pnpm_12 ];
  text = lib.replaceStrings
    (map (name: "@${name}@") (builtins.attrNames substitutions))
    (map toString (builtins.attrValues substitutions))
    (builtins.readFile ./sandbox.sh);
}
