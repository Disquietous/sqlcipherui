use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, RunEvent,
};

fn find_free_port() -> u16 {
    for port in 20000..=49151 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
    }
    panic!("No free port found in range 20000–49151");
}

async fn wait_for_backend(port: u16, timeout: Duration) -> bool {
    let url = format!("http://127.0.0.1:{}/health", port);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap();

    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if let Ok(resp) = client.get(&url).send().await {
            if resp.status().is_success() {
                return true;
            }
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    false
}

fn kill_backend(state: &Mutex<Option<Child>>) {
    if let Ok(mut guard) = state.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub fn run() {
    let port = find_free_port();

    tauri::Builder::default()
        .setup(move |app| {
            let resource_dir = app
                .path()
                .resource_dir()
                .expect("Failed to get resource dir");

            #[cfg(target_os = "macos")]
            let backend_bin = resource_dir.join("SQLCipherUI-backend");
            #[cfg(target_os = "windows")]
            let backend_bin = resource_dir.join("SQLCipherUI-backend.exe");

            let child = Command::new(&backend_bin)
                .env("SQLCIPHERUI_API_PORT", port.to_string())
                .env("SQLCIPHERUI_API_HOST", "127.0.0.1")
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap_or_else(|e| {
                    panic!("Failed to spawn backend at {:?}: {}", backend_bin, e)
                });

            app.manage(Mutex::new(Some(child)));

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if !wait_for_backend(port, Duration::from_secs(30)).await {
                    eprintln!("Backend failed to start within 30s");
                    app_handle.exit(1);
                    return;
                }

                let url = format!("http://localhost:{}", port);
                let _window = tauri::WebviewWindowBuilder::new(
                    &app_handle,
                    "main",
                    tauri::WebviewUrl::External(url.parse().unwrap()),
                )
                .title("SQLCipherUI")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1024.0, 600.0)
                .build()
                .expect("Failed to create window");
            });

            let show_item =
                MenuItemBuilder::with_id("show", "Show SQLCipherUI").build(app)?;
            let port_item =
                MenuItemBuilder::with_id("port", format!("Port: {}", port))
                    .enabled(false)
                    .build(app)?;
            let quit_item =
                MenuItemBuilder::with_id("quit", "Quit SQLCipherUI").build(app)?;

            let menu = MenuBuilder::new(app)
                .items(&[&show_item, &port_item])
                .separator()
                .items(&[&quit_item])
                .build()?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("SQLCipherUI")
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        let state = app.state::<Mutex<Option<Child>>>();
                        kill_backend(&state);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Error building Tauri application")
        .run(|app, event| match event {
            RunEvent::ExitRequested { .. } => {
                let state = app.state::<Mutex<Option<Child>>>();
                kill_backend(&state);
            }
            _ => {}
        });
}
