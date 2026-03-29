// src-tauri/src/lib.rs

pub mod commands;
pub mod config;
pub mod scouter;
pub mod state;

use std::path::PathBuf;

use commands::*;
use config::AppConfig;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 초기 로그 레벨: 개발 빌드=Debug, 릴리즈 빌드=Error
    #[cfg(debug_assertions)]
    let initial_level = log::LevelFilter::Debug;
    #[cfg(not(debug_assertions))]
    let initial_level = log::LevelFilter::Error;

    // 1. 실행파일 위치 기준 기본 디렉토리
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));

    // 2. config.json 로드 (없으면 기본값)
    let config_path = exe_dir.join("config.json");
    let config = AppConfig::load(&config_path);

    // 3. 데이터 디렉토리 결정: config.data_dir 우선, 없으면 exe_dir
    let data_dir: PathBuf = config
        .data_dir
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| exe_dir.clone());

    let log_dir = data_dir.join("logs");

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(initial_level)
                // 로그 파일: {data_dir}/logs/nscouter.log
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Folder {
                        path: log_dir,
                        file_name: Some("nscouter".to_string()),
                    },
                ))
                // 개발 중에는 stdout도 출력
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::Stdout,
                ))
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::new_with_config(config, config_path))
        .invoke_handler(tauri::generate_handler![
            connect_scouter,
            disconnect_scouter,
            start_xlog_stream,
            stop_xlog_stream,
            resolve_texts,
            get_object_list,
            get_xlog_profile,
            get_xlog_detail,
            start_counter_stream,
            start_alert_stream,
            set_log_level,
            start_mock_stream,
            get_config,
            save_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
