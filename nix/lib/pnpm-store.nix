{
  pkgs,
  iplConfigHook,
  pnpm,
  src,
  pname,
  version ? "0",
  lockFile ? src + "/pnpm-lock.yaml",
  # Directories the lockfile's `file:` tarballs live in, by path relative to
  # src, e.g. { ".sfs-deps" = <derivation holding *.tgz>; }. They have no URL
  # to fetch, so the store takes them from here.
  files ? { },
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
    postPatch = pkgs.lib.concatStrings (pkgs.lib.mapAttrsToList (dir: source: ''
      mkdir -p ${pkgs.lib.escapeShellArg dir}
      cp -r ${source}/. ${pkgs.lib.escapeShellArg dir}/
    '') files);
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
  inherit mitmCache store;
}
