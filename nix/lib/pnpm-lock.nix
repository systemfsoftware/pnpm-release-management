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
  platforms = import ./pnpm-platforms.nix { inherit lib; platform = null; };
  readLines = lockFile: lib.splitString "\n" (builtins.readFile lockFile);

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

  # Keep resolutions and platform restrictions together, including entries
  # without a resolution so they fail before any platform filtering.
  entriesOf =
    lines:
    (builtins.foldl'
      (
        state: line:
        let
          entryKey = builtins.match "  ([^ ].*):[[:space:]]*" line;
          resolution = builtins.match "    resolution:[[:space:]]*(.+)" line;
          restriction = builtins.match "    (os|cpu|libc):[[:space:]]*(.*)" line;
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
            state // { current = name; entries = state.entries // { ${name} = { resolution = null; }; }; }
        else if state.current != null && resolution != null then
          state
          // {
            entries = state.entries // {
              ${state.current} = state.entries.${state.current} // { resolution = flowMap (builtins.head resolution); };
            };
          }
        else if state.current != null && restriction != null then
          let axis = builtins.elemAt restriction 0;
          in state // {
            entries = state.entries // {
              ${state.current} = state.entries.${state.current} // {
                ${axis} = platforms.inlineList (builtins.elemAt restriction 1);
              };
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
      lines).entries;

  unresolvedEntries =
    entries:
    builtins.attrNames (lib.filterAttrs (_: entry: entry.resolution == null) entries);

  unresolvedPackages = lockFile: unresolvedEntries (entriesOf (readLines lockFile));

  packagesOf =
    entries:
    let
      unresolved = unresolvedEntries entries;
    in
    if unresolved == [ ] then
      entries
    else
      throw (
        lib.concatMapStringsSep "\n" (
          name: "pnpm-lock.nix: package ${name} has no resolution in the lockfile"
        ) unresolved
      );

  # pnpm warns but still installs required packages on an incompatible
  # platform. Filter only packages whose every snapshot is optional.
  optionalPackages = lines:
    let
      finish = state:
        if state.current == null then state else
        state // {
          optional = state.optional // {
            ${state.current} = (state.optional.${state.current} or true) && state.isOptional;
          };
          current = null;
        };
      parsed = builtins.foldl' (state: line:
        let
          entry = builtins.match "  (.*):[[:space:]]*([{][}])?[[:space:]]*" line;
          top = builtins.match "[^[:space:]#-][^:]*:.*" line;
        in
        if builtins.match "snapshots:[[:space:]]*" line != null then
          (finish state) // { inSnapshots = true; }
        else if builtins.match "---[[:space:]]*" line != null || top != null then
          (finish state) // { inSnapshots = false; }
        else if !state.inSnapshots then state
        else if entry != null then
          (finish state) // {
            current = builtins.head (lib.splitString "(" (unquote (trim (builtins.head entry))));
            isOptional = false;
          }
        else if state.current != null && builtins.match "    optional:[[:space:]]*true[[:space:]]*" line != null then
          state // { isOptional = true; }
        else state
      ) { inSnapshots = false; current = null; isOptional = false; optional = { }; }
        lines;
    in (finish parsed).optional;

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

  fetched = supported: lockFile:
    let
      lines = readLines lockFile;
      optional = optionalPackages lines;
      entries = entriesOf lines;
    in lib.filterAttrs (name: entry:
      !(isLocal name entry.resolution)
      && (!(optional.${name} or false) || platforms.compatible supported entry)
    ) (packagesOf entries);

  tarballCacheDataFor = supported: lockFile:
    lib.mapAttrs'
      (name: entry: lib.nameValuePair (urlOf name entry.resolution) { hash = integrityOf name entry.resolution; })
      (fetched supported lockFile);
in
{
  # Names of `packages:` entries that carry no `resolution:` line, for callers
  # and checks that want the list without triggering the throw in `packagesOf`.
  inherit unresolvedPackages;

  # The shape `mitm-cache.fetch` consumes: tarball URL -> { hash = integrity; }.
  tarballCacheData = tarballCacheDataFor { };
  inherit tarballCacheDataFor;
}
