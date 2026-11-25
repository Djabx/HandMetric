# Image OCI : `nix build .#docker && docker load < result`.
{ dockerTools, cacert, server }:

dockerTools.buildLayeredImage {
  name = "lifelog";
  tag = server.version;
  contents = [ cacert ];
  extraCommands = "mkdir -p data tmp && chmod 1777 tmp";
  config = {
    Entrypoint = [ "${server}/bin/lifelog-server" ];
    Env = [
      "LIFELOG_LISTEN=0.0.0.0:8080"
      "LIFELOG_DATABASE_URL=sqlite:///data/lifelog.db?mode=rwc"
      "SSL_CERT_FILE=${cacert}/etc/ssl/certs/ca-bundle.crt"
    ];
    ExposedPorts."8080/tcp" = { };
    Volumes."/data" = { };
  };
}
