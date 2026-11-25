# PWA LifeLog (fichiers statiques). mode = "auto" (servie par le serveur) ou "solo" (GitHub Pages).
{
  lib,
  stdenv,
  nodejs_24,
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
    hash = "sha256-7cz1qzqtYhm0X+Ul/zKN8JUTgFsssx/3UWwRERkfYxA=";
  };

  nativeBuildInputs = [
    nodejs_24
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
