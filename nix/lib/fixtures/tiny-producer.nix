{
  pkgs,
  # A directory holding tiny-lib-1.0.0.tgz.
  tinyLib,
}:
# The smallest flake a consumer can take tarballs from: one public member in
# `packages.<system>.workspace-tarballs`, as `mkPnpmWorkspacePackages` exports it.
{
  packages.${pkgs.stdenv.hostPlatform.system}.workspace-tarballs = tinyLib // {
    members = [
      {
        name = "@sandbox-proof/tiny-lib";
        attr = "tiny-lib";
        tarball = "tiny-lib-1.0.0.tgz";
      }
    ];
  };
}
