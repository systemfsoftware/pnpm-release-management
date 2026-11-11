{
  pkgs,
  iplConfigHook,
  pnpm,
  src,
  pname,
  version ? "0",
  lockFile ? src + "/pnpm-lock.yaml",
  workspaceFile ? if pkgs.lib.isDerivation src then null else src + "/pnpm-workspace.yaml",
  # The producers' tarballs (nix/lib/consumer-tarballs.nix), laid into src at
  # `tarballsDir` where the lockfile's `file:` paths name them. They have no URL
  # to fetch, so the store takes them from here.
  tarballs ? null,
  tarballsDir ? ".tarballs",
}:
let
  platforms = import ./pnpm-platforms.nix {
    inherit (pkgs) lib;
    platform = pkgs.stdenv.buildPlatform;
  };
  supported = if workspaceFile == null || !(builtins.pathExists workspaceFile)
    then { }
    else platforms.fromWorkspace workspaceFile;
  tarballCacheData = (import ./pnpm-lock.nix { inherit (pkgs) lib; }).tarballCacheDataFor supported lockFile;

  # One fixed-output derivation per tarball, keyed by the integrity the lockfile
  # records. mitm-cache replays them as a registry, so pnpm installs offline.
  mitmCache = pkgs.mitm-cache.passthru.fetch {
    name = "${pname}-pnpm-mitm-cache-${version}";
    data = tarballCacheData;
  };

  # Lays the tarballs into src where the lockfile's `file:` paths name them.
  copyTarballs = pkgs.lib.optionalString (tarballs != null) ''
    mkdir -p ${pkgs.lib.escapeShellArg tarballsDir}
    find ${tarballs}/ -name '*.tgz' -exec cp -L --no-preserve=mode -t ${pkgs.lib.escapeShellArg tarballsDir} {} +
  '';

  # Not a fixed-output derivation: the cache holds the selected tarballs, and
  # pnpm only reads it. The store dir is the output, in the layout pnpm writes
  # (`v*/files` next to `v*/index.db`).
  store = pkgs.stdenvNoCC.mkDerivation {
    pname = "${pname}-pnpm-store";
    inherit version src mitmCache;
    postPatch = copyTarballs;
    # A consumer's packageManager pin names whatever pnpm it uses on the host;
    # the store is built by the pnpm passed here, which must not fetch another.
    pnpm_config_manage_package_manager_versions = "false";
    nativeBuildInputs = [ pnpm iplConfigHook ];
    pnpmInstallFlags = [ "--store-dir=${placeholder "out"}" ];
    prePnpmInstall = import ./pnpm-mitm-replay.nix;
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
  inherit mitmCache store copyTarballs;
}
