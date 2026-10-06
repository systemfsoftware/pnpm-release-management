{
  pkgs,
  iplConfigHook,
  pnpm,
  src,
  pname,
  version ? "0",
  lockFile ? src + "/pnpm-lock.yaml",
}:
let
  tarballCacheData = (import ./pnpm-lock.nix { inherit (pkgs) lib; }).tarballCacheData lockFile;

  # One fixed-output derivation per tarball, keyed by the integrity the lockfile
  # records. mitm-cache replays them as a registry, so pnpm installs offline.
  mitmCache = pkgs.mitm-cache.passthru.fetch {
    name = "${pname}-pnpm-mitm-cache-${version}";
    data = tarballCacheData;
  };

  # Not a fixed-output derivation: the cache above holds every tarball, and pnpm
  # only reads it. The store dir itself is the output, in the layout pnpm writes
  # (`v*/files` next to `v*/index.db`).
  store = pkgs.stdenvNoCC.mkDerivation {
    pname = "${pname}-pnpm-store";
    inherit version src mitmCache;
    nativeBuildInputs = [ pnpm iplConfigHook ];
    pnpmInstallFlags = [ "--store-dir=${placeholder "out"}" ];
    dontInstall = true;
    dontFixup = true;
    buildPhase = ''
      runHook preBuild
      rm -rf "$out"/v*/tmp "$out"/v*/projects
      runHook postBuild
    '';
  };
in
{
  inherit mitmCache store;
}
