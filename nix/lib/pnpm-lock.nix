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

  packagesOf =
    lockFile:
    let
      state = builtins.foldl'
        (
          state: line:
          let
            entryKey = builtins.match "  ([^ ].*):[[:space:]]*" line;
            resolution = builtins.match "    resolution:[[:space:]]*(.+)" line;
          in
          if builtins.match "---[[:space:]]*" line != null then
            state // { inPackages = false; current = null; }
          else if builtins.match "packages:[[:space:]]*" line != null then
            state // { inPackages = true; current = null; }
          else if builtins.match "[^[:space:]#-][^:]*:.*" line != null then
            state // { inPackages = false; }
          else if !state.inPackages then
            state
          else if entryKey != null then
            state // { current = unquote (trim (builtins.head entryKey)); }
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
          entries = { };
        }
        (lib.splitString "\n" (builtins.readFile lockFile));
    in
    state.entries;

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
  # The shape `mitm-cache.fetch` consumes: tarball URL -> { hash = integrity; }.
  # Each https URL also answers on http as a redirect to the same fetch, so pnpm
  # can replay through mitm-cache's plain-HTTP proxy without TLS.
  tarballCacheData =
    lockFile:
    lib.concatMapAttrs
      (name: resolution:
        let
          url = urlOf name resolution;
        in
        { ${url} = { hash = integrityOf name resolution; }; }
        // lib.optionalAttrs (lib.hasPrefix "https://" url) {
          "http://${lib.removePrefix "https://" url}" = { redirect = url; };
        })
      (fetched lockFile);
}
