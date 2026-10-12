# Reads the `packages:` map out of pnpm's lockfile in pure Nix.
#
# Scrumplex/importPnpmLock.nix reads the same file through a derivation (yq ->
# JSON), which is an import-from-derivation: every system's evaluation builds a
# derivation for that system, so `nix eval .#devShells.<other-system>` fails with
# "platform mismatch". pnpm writes each resolution as a one-line flow map at a
# fixed indent, so reading it here keeps evaluation platform-independent while
# the tarball cache and the store stay ordinary per-system derivations.
{
  lib,
}:
let
  trim = lib.trim;

  unquote =
    value:
    let
      quoted = builtins.match "'(.*)'" value;
    in
    if quoted == null then value else builtins.head quoted;

  # `{integrity: sha512-…, tarball: https://…}` -> { integrity = "sha512-…"; … }
  flowMap =
    value:
    let
      items = lib.splitString "," (lib.removeSuffix "}" (lib.removePrefix "{" (trim value)));
      parseItem =
        item:
        let
          parts = builtins.match "([^:]*):(.*)" item;
        in
        lib.nameValuePair (trim (builtins.head parts)) (unquote (trim (builtins.elemAt parts 1)));
    in
    lib.listToAttrs (
      map parseItem (builtins.filter (item: builtins.match "[[:space:]]*" item == null) items)
    );

  # Every entry key under `packages:` is recorded, with `null` standing in until
  # its `resolution:` line arrives. An entry that never gets one would otherwise
  # vanish here and only surface later as an offline-install fetch error.
  entriesOf =
    lockFile:
    (builtins.foldl'
      (
        state: line:
        let
          entryKey = builtins.match "  ([^ ].*):[[:space:]]*" line;
          resolution = builtins.match "    resolution:[[:space:]]*(.+)" line;
        in
        if builtins.match "---[[:space:]]*" line != null then
          state // { inPackages = false; current = null; documents = state.documents + 1; }
        else if builtins.match "packages:[[:space:]]*" line != null then
          state // { inPackages = true; current = null; }
        else if builtins.match "[^[:space:]#-][^:]*:.*" line != null then
          state // { inPackages = false; }
        else if !state.inPackages then
          state
        else if entryKey != null then
          let
            name = unquote (trim (builtins.head entryKey));
          in
          # pnpm 12 opens a lockfile stream with the env document: its
          # packageManagerDependencies are pnpm's own binaries for every
          # platform, which run only when pnpm manages its version, and the
          # sandbox and store builds turn that off.
          if state.documents == 1 && builtins.match "(pnpm|@pnpm/exe\\.[^@]+)@.*" name != null then
            state // { current = null; }
          else
            state // { current = name; entries = state.entries // { ${name} = null; }; }
        else if state.current != null && resolution != null then
          state
          // {
            entries = state.entries // {
              ${state.current} = flowMap (builtins.head resolution);
            };
          }
        else
          state
      )
      {
        inPackages = false;
        current = null;
        documents = 0;
        entries = { };
      }
      (lib.splitString "\n" (builtins.readFile lockFile))).entries;

  unresolvedPackages =
    lockFile:
    builtins.attrNames (lib.filterAttrs (_: resolution: resolution == null) (entriesOf lockFile));

  packagesOf =
    lockFile:
    let
      unresolved = unresolvedPackages lockFile;
    in
    if unresolved == [ ] then
      entriesOf lockFile
    else
      throw (
        lib.concatMapStringsSep "\n" (
          name: "pnpm-lock.nix: package ${name} has no resolution in the lockfile"
        ) unresolved
      );

  # A `file:` tarball and a `directory` link are workspace-local: pnpm resolves
  # them from the source tree and nothing is fetched for them.
  isLocal =
    name: resolution:
    lib.hasPrefix "file:" name
    || (resolution.type or null) == "directory"
    || lib.hasPrefix "file:" (resolution.tarball or "")
    || lib.hasPrefix "link:" (resolution.tarball or "");

  urlOf =
    name: resolution:
    let
      parts = builtins.match "^(@?[^@]+)@(.+)$" name;
      scopedName = builtins.head parts;
      version = lib.last parts;
      packageName = lib.last (lib.splitString "/" scopedName);
    in
    if resolution ? tarball then
      resolution.tarball
    else if lib.hasPrefix "http" version then
      version
    else
      "https://registry.npmjs.org/${scopedName}/-/${packageName}-${version}.tgz";

  integrityOf =
    name: resolution:
    resolution.integrity or (throw ''
      pnpm-lock.nix: package ${name} has no integrity in the lockfile, so its
      tarball cannot be fetched by hash.
    '');

  fetched = lockFile: lib.filterAttrs (name: resolution: !(isLocal name resolution)) (packagesOf lockFile);
in
{
  # Names of `packages:` entries that carry no `resolution:` line, for callers
  # and checks that want the list without triggering the throw in `packagesOf`.
  inherit unresolvedPackages;

  # The shape `mitm-cache.fetch` consumes: tarball URL -> { hash = integrity; }.
  tarballCacheData =
    lockFile:
    lib.mapAttrs'
      (name: resolution: lib.nameValuePair (urlOf name resolution) { hash = integrityOf name resolution; })
      (fetched lockFile);
}
