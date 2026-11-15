# BendTT, the small kernel behind `bend PROOF.bend --verdict`. Bend ships its source (bendtt.lean, which carries a Lean
# proof that the kernel accepts no def of type Empty); this compiles it.
{ stdenv, lean4, bend }:
stdenv.mkDerivation {
  pname = "bendtt";
  version = bend.version or "0";
  dontUnpack = true;
  nativeBuildInputs = [ lean4 ];
  buildPhase = ''
    runHook preBuild
    cp ${bend}/libexec/bend/bend2/bendtt.lean .
    lean -c bendtt.c bendtt.lean
    leanc -O3 -DNDEBUG bendtt.c -o bendtt
    runHook postBuild
  '';
  installPhase = ''
    install -Dm755 bendtt $out/bin/bendtt
  '';
}
