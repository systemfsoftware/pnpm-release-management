{ lib, stdenvNoCC, fetchurl, deno }:
let
  version = deno.version;
  base = "https://dl.deno.land/release/v${version}";
  releases = {
    x86_64-linux = {
      target = "x86_64-unknown-linux-gnu";
      sha256 = "sha256-q0FrdHDz98bXtDY75HXl2M89hGnYZrO4RZozKlh0zQ0=";
    };
    aarch64-linux = {
      target = "aarch64-unknown-linux-gnu";
      sha256 = "sha256-ALoK4hq8Zc8V7f7aatdGRvrs2tWxSCifO0ESEAgSvts=";
    };
    aarch64-darwin = {
      target = "aarch64-apple-darwin";
      sha256 = "sha256-sKCN68ujR/m/I5GsDhL5nyfHo3WtVhuuzLNfATaazaQ=";
    };
  };

  system = stdenvNoCC.hostPlatform.system;
  release = releases.${system} or (throw "denort: no release archive pinned for ${system}");
in
assert lib.assertMsg (version == "2.9.7")
  "denort: pinned zips are v2.9.7 but pkgs.deno is ${version} — re-pin releases";
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
    platforms = lib.attrNames releases;
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
}
