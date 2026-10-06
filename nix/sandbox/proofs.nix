{ lib, writeShellApplication, sandbox, coreutils, curl, git, gnugrep, nodejs_24, nix, hello }:
let
  substitutions = {
    outsider = "${hello}";
  };
in
writeShellApplication {
  name = "sandbox-proofs";
  runtimeInputs = [ sandbox coreutils curl git gnugrep nodejs_24 nix ];
  text = lib.replaceStrings
    (map (name: "@${name}@") (builtins.attrNames substitutions))
    (map toString (builtins.attrValues substitutions))
    (builtins.readFile ./proofs.sh);
  excludeShellChecks = [ "SC2016" ];
}
