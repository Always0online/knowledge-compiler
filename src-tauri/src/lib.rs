use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct SidecarState {
  child: Mutex<Option<CommandChild>>,
}

struct AppPaths {
  root: PathBuf,
}

#[derive(Serialize)]
struct SettingsOut {
  #[serde(rename = "EXTRACT_LLM_API_KEY")]
  api_key: String,
  #[serde(rename = "KC_SCAN_INTERVAL_MS")]
  scan_interval_ms: u64,
  #[serde(rename = "KC_KNOWLEDGE_DIR")]
  knowledge_dir: String,
  autostart: bool,
}

fn resolve_root(app: &tauri::App) -> PathBuf {
  if let Ok(v) = std::env::var("KC_ROOT") {
    return PathBuf::from(v);
  }
  if let Ok(dir) = app.path().app_data_dir() {
    return dir;
  }
  if let Ok(dir) = app.path().resource_dir() {
    return dir;
  }
  std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn settings_file(root: &PathBuf) -> PathBuf {
  root.join(".state").join("settings.json")
}

fn read_settings(root: &PathBuf) -> serde_json::Value {
  match std::fs::read_to_string(settings_file(root)) {
    Ok(text) => serde_json::from_str(&text).unwrap_or(serde_json::json!({})),
    Err(_) => serde_json::json!({}),
  }
}

fn write_settings(root: &PathBuf, v: serde_json::Value) -> Result<(), String> {
  let path = settings_file(root);
  if let Some(dir) = path.parent() {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
  }
  std::fs::write(&path, serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?)
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_settings(app: AppHandle, state: State<'_, AppPaths>) -> SettingsOut {
  let v = read_settings(&state.root);
  SettingsOut {
    api_key: v
      .get("EXTRACT_LLM_API_KEY")
      .and_then(|x| x.as_str())
      .unwrap_or("")
      .to_string(),
    scan_interval_ms: v
      .get("KC_SCAN_INTERVAL_MS")
      .and_then(|x| x.as_u64())
      .unwrap_or(60000),
    knowledge_dir: v
      .get("KC_KNOWLEDGE_DIR")
      .and_then(|x| x.as_str())
      .unwrap_or("")
      .to_string(),
    autostart: app.autolaunch().is_enabled().unwrap_or(false),
  }
}

#[tauri::command]
fn save_settings(app: AppHandle, state: State<'_, AppPaths>, settings: serde_json::Value) -> Result<(), String> {
  let auto = settings.get("autostart").and_then(|x| x.as_bool()).unwrap_or(false);
  if auto {
    app.autolaunch().enable().map_err(|e| e.to_string())?;
  } else {
    app.autolaunch().disable().map_err(|e| e.to_string())?;
  }
  let mut obj = settings.as_object().cloned().unwrap_or_default();
  obj.remove("autostart");
  write_settings(&state.root, serde_json::Value::Object(obj))
}

fn send_cmd(app: &AppHandle, cmd: &str) {
  if let Some(state) = app.try_state::<SidecarState>() {
    if let Ok(mut guard) = state.child.lock() {
      if let Some(child) = guard.as_mut() {
        let _ = child.write(format!("{}\n", cmd).as_bytes());
      }
    }
  }
}

fn parse_status(s: &str) -> &'static str {
  if s.contains("scan-start") {
    "扫描中"
  } else if s.contains("scan-done") {
    "空闲"
  } else if s.contains("error") {
    "出错"
  } else {
    "运行中"
  }
}

fn open_path(p: &str) {
  #[cfg(windows)]
  let _ = std::process::Command::new("explorer").arg(p).spawn();
  #[cfg(not(windows))]
  let _ = std::process::Command::new("xdg-open").arg(p).spawn();
}

fn build_tray(app: &mut tauri::App) -> tauri::Result<()> {
  let menu = Menu::with_items(
    app,
    &[
      &MenuItem::with_id(app, "scan_now", "立即扫描", true, None::<&str>)?,
      &MenuItem::with_id(app, "pause", "暂停", true, None::<&str>)?,
      &MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?,
      &PredefinedMenuItem::separator(app)?,
      &MenuItem::with_id(app, "open_kb", "打开知识库", true, None::<&str>)?,
      &MenuItem::with_id(app, "open_log", "打开日志", true, None::<&str>)?,
      &PredefinedMenuItem::separator(app)?,
      &MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?,
    ],
  )?;

  let tray_icon = app.default_window_icon().cloned();
  let mut tray_builder = TrayIconBuilder::with_id("main");
  if let Some(icon) = tray_icon {
    tray_builder = tray_builder.icon(icon);
  }
  tray_builder
    .menu(&menu)
    .tooltip("KC 后台")
    .on_menu_event(|app, event| match event.id.as_ref() {
      "scan_now" => send_cmd(app, "scan-now"),
      "pause" => send_cmd(app, "pause"),
      "settings" => {
        if let Some(w) = app.get_webview_window("main") {
          let _ = w.show();
          let _ = w.set_focus();
        }
      }
      "open_kb" => {
        let root = app.state::<AppPaths>().root.clone();
        let p = std::env::var("KC_KNOWLEDGE_DIR")
          .unwrap_or_else(|_| root.join("knowledge_library").to_string_lossy().to_string());
        open_path(&p);
      }
      "open_log" => {
        let root = app.state::<AppPaths>().root.clone();
        open_path(&root.join(".state").join("logs").to_string_lossy().to_string());
      }
      "quit" => {
        send_cmd(app, "shutdown");
        app.exit(0);
      }
      _ => {}
    })
    .on_tray_icon_event(|_tray, event| {
      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        // 可选：左键打开设置窗
      }
    })
    .build(app)?;
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_log::Builder::default().build())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_single_instance::init(|app: &AppHandle, _argv: Vec<String>, _cwd: String| {
      if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
      }
    }))
    .plugin(tauri_plugin_autostart::init(
      tauri_plugin_autostart::MacosLauncher::LaunchAgent,
      None,
    ))
    .invoke_handler(tauri::generate_handler![get_settings, save_settings])
    .setup(|app| {
      let root = resolve_root(app);
      std::fs::create_dir_all(root.join(".state")).ok();
      std::fs::create_dir_all(root.join("knowledge_library")).ok();
      app.manage(AppPaths { root: root.clone() });

      let sidecar = app
        .shell()
        .sidecar("kc-core")?
        .args(["watch", "--json"])
        .env("KC_ROOT", root.to_string_lossy().to_string());
      let (mut rx, child) = sidecar.spawn()?;
      app.manage(SidecarState {
        child: Mutex::new(Some(child)),
      });

      let handle = app.handle().clone();
      tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
          match event {
            CommandEvent::Stdout(bytes) => {
              let s = String::from_utf8_lossy(&bytes).trim().to_string();
              if s.is_empty() {
                continue;
              }
              let status = parse_status(&s);
              if let Some(tray) = handle.tray_by_id("main") {
                let _ = tray.set_tooltip(Some(format!("KC 后台 - {}", status)));
              }
            }
            CommandEvent::Stderr(bytes) => {
              eprintln!("[sidecar] {}", String::from_utf8_lossy(&bytes));
            }
            CommandEvent::Terminated(_) => {
              if let Some(tray) = handle.tray_by_id("main") {
                let _ = tray.set_tooltip(Some("KC 后台 - 已停止"));
              }
            }
            _ => {}
          }
        }
      });

      build_tray(app)?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

