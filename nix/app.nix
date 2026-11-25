# PWA LifeLog (fichiers statiques). mode = "auto" (servie par le serveur) ou "solo" (GitHub Pages).
{
  lib,
  stdenv,
  nodejs_22,
  pnpm,
  fetchPnpmDeps,
  pnpmConfigHook,
  mode ? "auto",
}:

stdenv.mkDerivation (finalAttrs: {
  pname = "lifelog-app";
  version = "0.1.0";

  src = lib.fileset.toSource {
    root = ../app;
    fileset = lib.fileset.difference ../app (
      lib.fileset.unions [
        (lib.fileset.maybeMissing ../app/node_modules)
        (lib.fileset.maybeMissing ../app/dist)
      ]
    );
  };

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    pnpm = pnpm;
    fetcherVersion = 4;
    hash = "sha256-1ReRSiznH0qnYHz4DwPBsgz9Z/pP7y2KAKBbGGhvwU4=";
  };

  nativeBuildInputs = [
    nodejs_22
    pnpm
    pnpmConfigHook
  ];

  env.LIFELOG_MODE = mode;

  buildPhase = ''
    runHook preBuild
    pnpm test
    pnpm build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cp -r dist $out
    runHook postInstall
  '';

  meta = {
    description = "PWA LifeLog";
    license = lib.licenses.mit;
  };
})
