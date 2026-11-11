{
  pkgs,
  # Producer flakes by name, e.g. `{ core = core; xstate = xstate; }`. Each one
  # must give `packages.<system>.workspace-tarballs` (see mkPnpmWorkspacePackages).
  producers,
  # Producer names in the order that wins when two ship a package with the
  # same attribute name. Null refuses any such clash.
  precedence ? null,
}:
let
  inherit (pkgs) lib;
  system = pkgs.stdenv.hostPlatform.system;

  # The directory, relative to the consumer's root, the tarballs are laid in.
  dir = ".deps";

  producerNames = builtins.attrNames producers;

  order =
    if precedence == null then producerNames
    else
      assert lib.sort lib.lessThan precedence == producerNames
        || throw "mkProducerTarballs: precedence [${lib.concatStringsSep " " precedence}] must name each of the producers [${lib.concatStringsSep " " producerNames}] once";
      precedence;

  tarballsOf = producer:
    let
      packages = producers.${producer}.packages.${system}
        or (throw "mkProducerTarballs: ${producer} has no packages.${system}");
      workspace = packages.workspace-tarballs
        or (throw "mkProducerTarballs: ${producer} has no packages.${system}.workspace-tarballs; build it with lib.mkPnpmWorkspacePackages");
    in
    map (member: {
      inherit producer;
      inherit (member) name attr;
      source = "${workspace}/${member.tarball}";
    }) workspace.members;

  all = lib.concatMap tarballsOf order;

  clashes = lib.filter (attr: lib.count (t: t.attr == attr) all > 1) (lib.unique (map (t: t.attr) all));

  clashReport = lib.concatStringsSep ", " (map
    (attr: "${attr} (${lib.concatStringsSep ", " (map (t: t.producer) (lib.filter (t: t.attr == attr) all))})")
    clashes);

  chosen =
    if precedence != null then
      builtins.foldl' (kept: t: if lib.any (k: k.attr == t.attr) kept then kept else kept ++ [ t ]) [ ] all
    else
      assert clashes == [ ]
        || throw "mkProducerTarballs: more than one producer ships ${clashReport}; pass `precedence` to choose";
      all;

  sorted = lib.sort (a: b: a.name < b.name) chosen;

  tarballs = pkgs.runCommand "producer-tarballs" { } ''
    mkdir -p "$out"
    ${lib.concatMapStrings (t: "ln -s ${lib.escapeShellArg t.source} \"$out\"/${lib.escapeShellArg "${t.attr}.tgz"}\n") sorted}
    printf '%s\n' ${lib.escapeShellArg (builtins.toJSON (map (t: { inherit (t) name; file = "${t.attr}.tgz"; }) sorted))} > "$out/index.json"
  '';
in
lib.extendDerivation true {
  # The `overrides:` entries of the consumer's pnpm-workspace.yaml: every
  # producer package, under a file name that carries no version. The `@*` form
  # leaves a consumer's own workspace member of the same name linked: a bare
  # name would replace it with the producer's tarball.
  overrides = lib.concatMapStrings (t: "  \"${t.name}@*\": file:${dir}/${t.attr}.tgz\n") sorted;

  # Real files under `.deps`: the sandbox reads no store path outside its
  # closure, so a symlink into the store would not install. It writes into the
  # git root of the directory the shell is entered from, so enter it from the
  # consumer's checkout.
  shellHook = ''
    if ! producer_root=$(command -v git > /dev/null && git rev-parse --show-toplevel 2> /dev/null); then
      producer_root=$PWD
    fi
    mkdir -p "$producer_root/${dir}"
    rm -f "$producer_root/${dir}"/*.tgz "$producer_root/${dir}/index.json"
    cp -rL --no-preserve=mode ${tarballs}/. "$producer_root/${dir}/"
    unset producer_root
  '';
} tarballs
