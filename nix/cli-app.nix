{ lib, stdenv, pnpm_11, iplConfigHook, nodejs_24, deno, denort, mitmCache, src, appName }:
stdenv.mkDerivation (finalAttrs: {
  pname = appName;
  version = "0.0.0";
  inherit src mitmCache;

  nativeBuildInputs = [ nodejs_24 pnpm_11 iplConfigHook deno ];

  # `deno compile` appends its runtime payload in a section binutils' strip removes
  # ("Could not find standalone binary section"); the shipped binary must stay unstripped.
  dontStrip = true;

  buildPhase = ''
    runHook preBuild
    pnpm --filter "@systemfsoftware/${appName}..." build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    export DENO_DIR="$(mktemp -d)/deno-dir"
    mkdir -p "$DENO_DIR"
    cp -r "${denort}/." "$DENO_DIR/"
    chmod -R u+w "$DENO_DIR"
    pnpm --filter "@systemfsoftware/${appName}" package
    install -Dm755 "apps/${appName}/dist/${appName}" "$out/bin/${appName}"
    runHook postInstall
  '';

  meta = {
    description = "pnpm-release-management CLI: ${appName}";
    homepage = "https://github.com/systemfsoftware/pnpm-release-management";
    license = lib.licenses.asl20;
    mainProgram = appName;
    platforms = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.fromSource ];
  };
})
