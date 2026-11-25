use clap::Parser;
use tracing_subscriber::EnvFilter;

/// Serveur auto-hébergé LifeLog. La configuration passe par les variables
/// d'environnement LIFELOG_* et, en option, un fichier TOML (LIFELOG_CONFIG).
#[derive(Parser)]
#[command(version, about)]
struct Cli {
    /// Vérifie la configuration et la base, puis quitte.
    #[arg(long)]
    check: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,tower_http=warn,sqlx=warn")))
        .init();
    let cli = Cli::parse();
    let config = lifelog_server::config::Config::load()?;
    let listen = config.listen.clone();
    let state = lifelog_server::AppState::new(config).await?;
    if cli.check {
        println!("configuration et base OK");
        return Ok(());
    }
    {
        let db = state.db.clone();
        tokio::spawn(async move {
            loop {
                if let Err(e) = db.purge_sessions().await {
                    tracing::warn!("purge des sessions : {e}");
                }
                tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
            }
        });
    }
    let app = lifelog_server::router(state);
    let listener = tokio::net::TcpListener::bind(&listen).await?;
    tracing::info!("LifeLog écoute sur http://{listen}");
    axum::serve(listener, app).with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await?;
    Ok(())
}
