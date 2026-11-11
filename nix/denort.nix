{ lib, stdenvNoCC, fetchurl, deno }:
let
  version = deno.version;
  base = "https://dl.deno.land/release/v${version}";
  targets = {
    x86_64-linux = "x86_64-unknown-linux-gnu";
    aarch64-linux = "aarch64-unknown-linux-gnu";
  };
  # One entry per deno version a nixpkgs this flake can follow ships: a consumer that makes this
  # flake follow a newer nixpkgs gets a newer deno, so a single pinned version breaks it.
  hashes = {
    "2.9.7" = {
      x86_64-linux = "sha256-q0FrdHDz98bXtDY75HXl2M89hGnYZrO4RZozKlh0zQ0=";
      aarch64-linux = "sha256-ALoK4hq8Zc8V7f7aatdGRvrs2tWxSCifO0ESEAgSvts=";
    };
    "2.9.8" = {
      x86_64-linux = "sha256-umgi0HCf/nI6mdse1F+MgK2yDrR5BhPUlvjwVnstmfg=";
      aarch64-linux = "sha256-2E+1i5lI6/VVhqcMU5FAPwgoMCPmClTh4gEanFmM6Ts=";
    };
  };

  system = stdenvNoCC.hostPlatform.system;
  target = targets.${system} or (throw "denort: no release archive pinned for ${system}");
  pinned = hashes.${version} or (throw
    "denort: no zips pinned for pkgs.deno ${version} (pinned: ${lib.concatStringsSep ", " (lib.attrNames hashes)}) — add its hashes");
  release = { inherit target; sha256 = pinned.${system}; };
in
stdenvNoCC.mkDerivation {
  pname = "denort-cache";
  inherit version;

  src = fetchurl {
    url = "${base}/denort-${release.target}.zip";
    inherit (release) sha256;
  };

  dontUnpack = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/dl/release/v${version}"
    cp "$src" "$out/dl/release/v${version}/denort-${release.target}.zip"
    runHook postInstall
  '';

  meta = {
    description = "Pre-seeded deno compile runtime cache (offline sandbox support)";
    homepage = "https://deno.land";
    license = lib.licenses.mit;
    platforms = lib.attrNames targets;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
}
