# mitm-cache 0.1.2 mints leaf certificates with no serverAuth extended key
# usage. macOS's TLS policy requires it, so pnpm 12 on darwin refused every
# replayed https fetch with EkuError even with the CA trusted. hudsucker
# upstream now sets these fields; the patch applies the same lines to the
# hudsucker 0.22 that mitm-cache vendors.
{ mitm-cache, writableTmpDirAsHomeHook }:
mitm-cache.overrideAttrs (old: {
  nativeBuildInputs = (old.nativeBuildInputs or [ ]) ++ [ writableTmpDirAsHomeHook ];
  postPatch = (old.postPatch or "") + ''
    patch -p1 -d "$cargoDepsCopy/source-registry-0/hudsucker-0.22.0" < ${./patches/hudsucker-server-auth-leaf.patch}
  '';
})
