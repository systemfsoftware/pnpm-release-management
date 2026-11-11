{
  pkgs,
  # Flakes whose `packages.<system>.workspace-tarballs` a consumer installs
  # from. A producer is whatever exports that output: every public member of its
  # workspace is one tarball in it.
  producers,
  # The system whose `workspace-tarballs` is read. The tarballs rebuild
  # bit-for-bit on every system, so a macOS shell takes the Linux ones.
  system ? pkgs.stdenv.hostPlatform.system,
}:
let
  inherit (pkgs) lib;

  tarballsOf = index: producer:
    producer.packages.${system}.workspace-tarballs
      or (throw "consumer-tarballs: producer ${toString index} exports no packages.${system}.workspace-tarballs");

  links = lib.concatLists (lib.imap0
    (index: producer:
      let tarballs = tarballsOf index producer;
      in map
        (member: {
          inherit (member) name attr;
          path = "${tarballs}/${member.tarball}";
        })
        tarballs.members)
    producers);

  duplicated = lib.unique (map (link: link.attr) (lib.filter
    (link: lib.count (other: other.attr == link.attr) links > 1)
    links));
in
# A name stands for one package, so two producers cannot both ship it: the
# lockfile's `file:` path would not say which one it means.
assert duplicated == [ ]
  || throw "consumer-tarballs: more than one producer ships ${lib.concatStringsSep ", " duplicated}";
# Each tarball is named for its package, not its version, so the `file:` paths in
# a consumer's manifests and lockfile stay put when a producer releases:
# `pnpm install --update-checksums` records the new bytes.
pkgs.linkFarm "consumer-tarballs" (map (link: { name = "${link.attr}.tgz"; inherit (link) path; }) links)
