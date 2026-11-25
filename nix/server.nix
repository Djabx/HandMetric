# Serveur LifeLog, avec la PWA embarquée (servie sur la même origine).
{
  lib,
  rustPlatform,
  pkg-config,
  openssl,
  makeWrapper,
  app,
}:

rustPlatform.buildRustPackage {
  pname = "lifelog-server";
  version = "0.1.0";

  src = lib.fileset.toSource {
    root = ../server;
    fileset = lib.fileset.unions [
      ../server/Cargo.toml
      ../server/Cargo.lock
      ../server/src
      ../server/migrations
      ../server/tests
    ];
  };

  cargoLock.lockFile = ../server/Cargo.lock;

  nativeBuildInputs = [
    pkg-config
    makeWrapper
  ];
  buildInputs = [ openssl ];

  postInstall = ''
    mkdir -p $out/share/lifelog
    ln -s ${app} $out/share/lifelog/www
    wrapProgram $out/bin/lifelog-server \
      --set-default LIFELOG_STATIC_DIR $out/share/lifelog/www
  '';

  passthru = { inherit app; };

  meta = {
    description = "Serveur de synchronisation auto-hébergé de LifeLog";
    license = lib.licenses.mit;
    mainProgram = "lifelog-server";
  };
}
