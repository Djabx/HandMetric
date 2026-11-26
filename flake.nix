{
  description = "LifeLog : les succès de ta vie, comme dans un jeu vidéo";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAll (pkgs:
        let
          app = pkgs.callPackage ./nix/app.nix { };
          server = pkgs.callPackage ./nix/server.nix { inherit app; };
        in
        {
          inherit app server;
          # Version GitHub Pages : jamais de serveur.
          app-solo = app.override { mode = "solo"; };
          default = server;
        } // pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
          docker = pkgs.callPackage ./nix/docker.nix { inherit server; };
        });

      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            cargo rustc rustfmt clippy rust-analyzer
            nodejs_24 pnpm
            sqlite postgresql
          ];
          RUST_SRC_PATH = "${pkgs.rustPlatform.rustLibSrc}";
        };
      });

      checks = forAll (pkgs: {
        inherit (self.packages.${pkgs.stdenv.hostPlatform.system}) app server;
      });

      nixosModules.default = import ./nix/module.nix self;
      nixosModules.lifelog = self.nixosModules.default;

      formatter = forAll (pkgs: pkgs.nixfmt);
    };
}
