# Serveur LifeLog, avec la PWA embarquée (servie sur la même origine).
{
  lib,
  rustPlatform,
  makeWrapper,
  app,
}:

rustPlatform.buildRustPackage {
  pname = "lifelog-server";
  # Version tenue par release-please dans Cargo.toml.
  version = (lib.importTOML ../server/Cargo.toml).package.version;

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

  # Les tests (SQLite et PostgreSQL) tournent dans la CI GitHub (job server) ;
  # les relancer ici recompilerait tout le projet une seconde fois.
  doCheck = false;

  nativeBuildInputs = [ makeWrapper ];

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
