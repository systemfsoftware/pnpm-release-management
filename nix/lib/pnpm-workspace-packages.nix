{
  pkgs,
  src,
  iplConfigHook,
  pname ? "workspace",
  pnpm ? pkgs.pnpm_12,
  nodejs ? pkgs.nodejs_24,
  buildScript ? "build",
  nativeBuildInputs ? [ ],
  # Directories the lockfile's `file:` tarballs live in, by path relative to
  # src, as for mkPnpmConsumerStore. Both the store and the tarball build
  # install from the lockfile, so both get them.
  files ? { },
  # The public members to build and pack, by package name. Null packs every
  # public member.
  members ? null,
  # A lockfile for the tarball build in place of src's pnpm-lock.yaml: one
  # whose importers are a subset of the workspace, such as `pnpm install
  # --lockfile-only` writes for a copy of it cut down to the packed members.
  # The build installs only those importers, each with exactly the
  # dependencies the lockfile records for it, and fetches only its tarballs.
  # The packed manifests stay src's. The sandbox store keeps src's lockfile.
  lockFile ? null,
}:
let
  inherit (pkgs) lib;

  workspaceGlobs =
    let
      lines = lib.splitString "\n" (builtins.readFile (src + "/pnpm-workspace.yaml"));
      entry = line: builtins.match ''[[:space:]]*-[[:space:]]+["']?([^"'#]+[^"'#[:space:]])["']?[[:space:]]*(#.*)?'' line;
      inPackages =
        builtins.foldl'
          (acc: line:
            if builtins.match "packages:[[:space:]]*" line != null then acc // { on = true; }
            else if acc.on && builtins.match "[^[:space:]-].*" line != null then acc // { on = false; }
            else if acc.on && entry line != null then acc // { globs = acc.globs ++ [ (builtins.head (entry line)) ]; }
            else acc)
          { on = false; globs = [ ]; }
          lines;
    in
    inPackages.globs;

  dirsOf = glob:
    if lib.hasPrefix "!" glob then [ ]
    else if lib.hasSuffix "/*" glob then
      let parent = lib.removeSuffix "/*" glob;
      in if !builtins.pathExists (src + "/${parent}") then [ ]
      else lib.mapAttrsToList (name: _: "${parent}/${name}")
        (lib.filterAttrs (name: type: type == "directory" && builtins.pathExists (src + "/${parent}/${name}/package.json"))
          (builtins.readDir (src + "/${parent}")))
    else if lib.hasInfix "*" glob then
      throw "mkPnpmWorkspacePackages: workspace glob '${glob}' is not supported; use 'dir/*' or a literal path"
    else if builtins.pathExists (src + "/${glob}/package.json") then [ glob ]
    else [ ];

  excluded = map (glob: lib.removePrefix "!" glob) (lib.filter (lib.hasPrefix "!") workspaceGlobs);

  projects = lib.filter (dir: !(builtins.elem dir excluded)) (lib.unique (lib.concatMap dirsOf workspaceGlobs));

  manifestOf = dir: lib.importJSON (src + "/${dir}/package.json");

  public = lib.filter (dir: !((manifestOf dir).private or false)) projects;

  attrOf = name: lib.last (lib.splitString "/" name);

  publicEntries = map (dir: rec {
    inherit dir;
    name = (manifestOf dir).name;
    version = (manifestOf dir).version;
    attr = attrOf name;
    tarball = "${attr}-${version}.tgz";
  }) public;

  unknownMembers = lib.filter (name: !(lib.any (e: e.name == name) publicEntries)) (if members == null then [ ] else members);

  entries =
    assert unknownMembers == [ ]
      || throw "mkPnpmWorkspacePackages: members ${lib.concatStringsSep ", " unknownMembers} are not public packages of the workspace";
    if members == null then publicEntries else lib.filter (e: builtins.elem e.name members) publicEntries;

  duplicateAttrs = lib.filter (attr: lib.count (e: e.attr == attr) entries > 1) (map (e: e.attr) entries);

  pinnedPnpm =
    let
      packageManager = (lib.importJSON (src + "/package.json")).packageManager or null;
      pinned = if packageManager == null then null else builtins.match "pnpm@([^+]+).*" packageManager;
    in
    if pinned == null then null else builtins.head pinned;

  storeOf = lock:
    assert pinnedPnpm == null || pinnedPnpm == pnpm.version
      || throw "mkPnpmWorkspacePackages: package.json pins pnpm@${pinnedPnpm} but the build uses pnpm ${pnpm.version}; pin the version Nix provides so every pnpm run resolves the same way";
    import ./pnpm-store.nix ({
      inherit pkgs pname pnpm src iplConfigHook files;
    } // lib.optionalAttrs (lock != null) { lockFile = lock; });

  deps = storeOf null;
  buildDeps = if lockFile == null then deps else storeOf lockFile;

  inherit (deps) mitmCache;
  pnpm-store = deps.store;

  # Projects the lockfile has no importer for leave the workspace, and every
  # importer's manifest is given exactly the dependencies the lockfile records
  # for it, so the frozen install accepts the lockfile. The manifests come back
  # before the build, so the tarballs pack src's.
  restrictToLockFile = ''
    cp ${lockFile} pnpm-lock.yaml
    yq -o=json '.importers' pnpm-lock.yaml > "$NIX_BUILD_TOP/importers.json"
    for dir in ${lib.escapeShellArgs projects}; do
      jq -e --arg dir "$dir" 'has($dir)' "$NIX_BUILD_TOP/importers.json" > /dev/null || rm -rf "$dir"
    done
    for dir in ${lib.escapeShellArgs (map (e: e.dir) entries)}; do
      [ -d "$dir" ] || { echo "mkPnpmWorkspacePackages: member $dir has no importer in ${lockFile}" >&2; exit 1; }
    done
    jq -r 'keys[]' "$NIX_BUILD_TOP/importers.json" | while read -r dir; do
      mkdir -p "$NIX_BUILD_TOP/manifests/$dir"
      cp "$dir/package.json" "$NIX_BUILD_TOP/manifests/$dir/package.json"
      jq --arg dir "$dir" --slurpfile importers "$NIX_BUILD_TOP/importers.json" '
        reduce ("dependencies", "devDependencies", "optionalDependencies") as $field (.;
          ($importers[0][$dir][$field] // {} | map_values(.specifier)) as $locked
          | if $locked == {} then del(.[$field]) else .[$field] = $locked end)
      ' "$NIX_BUILD_TOP/manifests/$dir/package.json" > "$dir/package.json"
    done
  '';

  restoreManifests = ''
    jq -r 'keys[]' "$NIX_BUILD_TOP/importers.json" | while read -r dir; do
      cp "$NIX_BUILD_TOP/manifests/$dir/package.json" "$dir/package.json"
    done
  '';

  workspace-tarballs =
    assert duplicateAttrs == [ ]
      || throw "mkPnpmWorkspacePackages: packages share the attribute name(s) ${lib.concatStringsSep ", " (lib.unique duplicateAttrs)}";
    # With no public member there is nothing to pack, and a build with no
    # `--filter` would run every private package's build instead.
    if entries == [ ] then
      pkgs.runCommand "${pname}-tarballs" { passthru.members = entries; } ''
        mkdir -p "$out"
        echo '[]' > "$out/index.json"
      ''
    else
    pkgs.stdenvNoCC.mkDerivation {
      pname = "${pname}-tarballs";
      version = "0";
      inherit src;
      inherit (buildDeps) mitmCache;
      postPatch = buildDeps.copyFiles + lib.optionalString (lockFile != null) restrictToLockFile;
      preBuild = lib.optionalString (lockFile != null) restoreManifests;
      prePnpmInstall = import ./pnpm-mitm-replay.nix;

      nativeBuildInputs = [ nodejs pnpm iplConfigHook pkgs.jq ] ++ lib.optional (lockFile != null) pkgs.yq-go ++ nativeBuildInputs;

      buildPhase = ''
        runHook preBuild
        pnpm --recursive --if-present ${lib.concatMapStringsSep " " (e: "--filter ${lib.escapeShellArg "${e.name}..."}") entries} run ${lib.escapeShellArg buildScript}
        runHook postBuild
      '';

      installPhase = ''
        runHook preInstall
        mkdir -p "$out"
        ${lib.concatMapStringsSep "\n" (e: ''
          (cd ${lib.escapeShellArg e.dir} && pnpm pack --out "$out"/${lib.escapeShellArg e.tarball})
        '') entries}
        jq -n '$ARGS.positional | map(split("=") | {name: .[0], file: .[1]})' --args \
          ${lib.concatMapStringsSep " " (e: lib.escapeShellArg "${e.name}=${e.tarball}") entries} > "$out/index.json"
        runHook postInstall
      '';

      passthru.members = entries;
    };

  perPackage = lib.listToAttrs (map (e: {
    name = e.attr;
    value = pkgs.runCommand "${e.attr}-${e.version}.tgz" { } ''
      cp ${workspace-tarballs}/${lib.escapeShellArg e.tarball} "$out"
    '';
  }) entries);
in
perPackage // { inherit workspace-tarballs pnpm-store mitmCache; }
