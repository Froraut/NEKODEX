#![forbid(unsafe_op_in_unsafe_fn)]

#[cfg(not(target_os = "macos"))]
compile_error!("The owned Native worker is Mac-first; Windows/Linux are phase 2");

use codex_app_server::{
    AppServerExit, AppServerRuntimeOptions, AppServerTransport, CodeModeHostTransport,
    PluginStartupTasks, RemoteControlStartupMode, run_main_with_transport_options,
};
use codex_arg0::Arg0DispatchPaths;
use codex_async_utils::THREAD_STACK_SIZE_BYTES;
use codex_config::LoaderOverrides;
use codex_core::config::ConfigBuilder;
use codex_login::AuthCredentialsStoreMode;
use codex_protocol::account::PlanType;
use codex_protocol::protocol::SessionSource;
use codex_utils_cli::CliConfigOverrides;
use codex_websocket_auth::WebsocketAuthSettings;
use std::io;
use std::path::PathBuf;

const BUILD_INFO: &str = include_str!("../source-pin.json");

fn main() {
    if let Err(error) = entry() {
        // No raw configuration, provider, profile or credential details on stderr.
        eprintln!("owned_native_worker_unavailable:{:?}", error.kind());
        std::process::exit(78);
    }
}

fn entry() -> io::Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).take(3).collect();
    let account_info = matches!(args.as_slice(), [arg] if arg == "--account-info");
    match args.as_slice() {
        [arg] if arg == "--build-info" => {
            print!("{BUILD_INFO}");
            return Ok(());
        }
        [] => {}
        [arg] if arg == "--stdio" => {}
        [arg] if arg == "--account-info" => {}
        _ => return Err(io::Error::new(io::ErrorKind::InvalidInput, "unsupported arguments")),
    }
    // No fallback to an ordinary user's profile or cwd. Full path/config/catalog
    // admission remains the trusted main owner's separate responsibility.
    let home = explicit_directory("HOME")?;
    let profile = explicit_directory("CODEX_HOME")?;
    let sqlite = explicit_directory("CODEX_SQLITE_HOME")?;
    let cwd = std::fs::canonicalize(std::env::current_dir()?)?;
    if home == profile || home == sqlite || profile == sqlite || !cwd.starts_with(&home) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "private profile boundary required"));
    }
    // Do not call arg0_dispatch[_or_else]: no helper argv dispatch, .env loading,
    // PATH aliases, arbitrary command helpers or managed-policy debug hooks.
    let executable = std::fs::canonicalize(std::env::current_exe()?)?;
    let handle = std::thread::Builder::new()
        .name("nekodex-owned-native".into())
        .stack_size(THREAD_STACK_SIZE_BYTES)
        .spawn(move || run(executable, account_info))?;
    match handle.join() {
        Ok(result) => result,
        Err(_) => Err(io::Error::other("owned runtime failed")),
    }
}

fn explicit_directory(key: &str) -> io::Result<PathBuf> {
    let value = std::env::var_os(key)
        .map(PathBuf::from)
        .filter(|value| value.is_absolute())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "explicit private directory required"))?;
    let canonical = std::fs::canonicalize(&value)?;
    if canonical != value || !std::fs::metadata(&canonical)?.is_dir() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "canonical private directory required"));
    }
    Ok(canonical)
}

fn run(executable: PathBuf, account_info: bool) -> io::Result<()> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .thread_stack_size(THREAD_STACK_SIZE_BYTES)
        .enable_all()
        .build()?;
    if account_info {
        return runtime.block_on(read_account_info());
    }
    let result = runtime.block_on(run_main_with_transport_options(
        Arg0DispatchPaths {
            // Any attempted re-exec with helper argv is refused by entry(). No
            // Linux sandbox or retired exec wrapper is claimed by this Mac leaf.
            codex_self_exe: Some(executable),
            codex_linux_sandbox_exe: None,
            main_execve_wrapper_exe: None,
        },
        CliConfigOverrides::default(),
        LoaderOverrides::default(), // System/MDM/cloud requirements remain enabled.
        true,                       // strict_config
        false,                      // default_analytics_enabled
        AppServerTransport::Stdio,
        SessionSource::Custom("nekodex-owned-worker".into()),
        WebsocketAuthSettings::default(), // No websocket/listener transport exists.
        AppServerRuntimeOptions {
            code_mode_host_transport: CodeModeHostTransport::Local,
            plugin_startup_tasks: PluginStartupTasks::Skip,
            remote_control_startup_mode: RemoteControlStartupMode::DisabledEphemeral,
            install_shutdown_signal_handler: true,
            managed_daemon: false,
        },
    ));
    match result? {
        AppServerExit::Graceful => Ok(()),
        AppServerExit::Forced => std::process::exit(0),
    }
}

/// Local native-library metadata only. This branch never constructs app-server,
/// ThreadManager, OTEL, environments, plugins or a models manager. Its supported
/// input is the exclusive fresh epoch written by official CLI device login.
/// Generic stored PAT/agent authentication may resolve remotely in upstream's
/// loader; the host must run this branch with its no-network startup boundary.
async fn read_account_info() -> io::Result<()> {
    // `false` below disables API-key env only; the upstream loader also recognizes
    // CODEX_ACCESS_TOKEN. Refuse ambient auth/experimental route selection before
    // native config/auth loading, without inspecting or reporting their values.
    if std::env::vars_os().any(|(key, _)| {
        let key = key.to_string_lossy();
        matches!(key.as_ref(), "OPENAI_API_KEY" | "CODEX_API_KEY" | "CODEX_ACCESS_TOKEN")
            || key.starts_with("CODEX_WORKLOAD_IDENTITY")
            || key.starts_with("CODEX_AUTH_")
            || key.starts_with("CODEX_LOGIN_")
            || key.starts_with("CODEX_REFRESH_TOKEN_")
            || key.starts_with("CODEX_REVOKE_TOKEN_")
    }) {
        return Err(io::Error::new(io::ErrorKind::PermissionDenied, "ambient auth is unsupported"));
    }
    // This is the same local-config bootstrap used by the official CLI. The
    // default cloud loader is empty here; no cloud policy is claimed inspected.
    // All system/MDM/local requirements remain active. Classification grants no
    // execution: full cloud-aware public requirements are checked afterward.
    let config = ConfigBuilder::default().strict_config(true).build().await?;
    let auth_config = config.auth_config();
    auth_config.validate()?;
    if auth_config.auth_credentials_store_mode != AuthCredentialsStoreMode::File
        || config.chatgpt_base_url != "https://chatgpt.com/backend-api/"
    {
        return Err(io::Error::new(io::ErrorKind::PermissionDenied, "unsupported auth route"));
    }
    let auth = auth_config.load_auth(false).await?;
    let uses_codex_backend = auth.as_ref().is_some_and(|auth| auth.uses_codex_backend());
    let is_chatgpt = auth.as_ref().is_some_and(|auth| auth.is_chatgpt_auth());
    let plan = auth.as_ref().and_then(|auth| auth.account_plan_type()).map(PlanType::from);
    let classification = match (&auth, is_chatgpt, uses_codex_backend, plan) {
        (None, _, _, _) => "unauthenticated",
        (Some(_), true, true, Some(PlanType::Pro | PlanType::ProLite | PlanType::ProMax)) => {
            "personal-pro"
        }
        _ => "unsupported",
    };
    let value = serde_json::json!({
        "schemaVersion": 1,
        "type": if auth.is_none() { "none" } else if is_chatgpt { "chatgpt" } else { "unsupported" },
        "planType": plan,
        "usesCodexBackend": uses_codex_backend,
        "classification": classification,
    });
    println!("{value}");
    Ok(())
}
