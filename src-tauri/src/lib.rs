// src-tauri/src/lib.rs

pub mod commands;
pub mod config;
pub mod profile_store;
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
    let data_dir: PathBuf = config::resolve_data_dir(&config, &exe_dir);

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
            get_object_env,
            get_object_thread_list,
            get_object_sockets,
            get_object_class_list,
            get_object_active_services,
            get_object_heap_histogram,
            get_agent_config,
            get_server_config,
            get_summary,
            get_error_summary,
            get_interaction,
            load_past_xlog,
            load_xlog_by_gxid,
            get_xlog_full_profile,
            get_active_speed,
            get_active_speed_by_object,
            get_service_group,
            get_stack_index,
            search_profiles,
            get_stack_dump,
            get_thread_detail,
            save_agent_config,
            get_today_counter,
            get_today_visitor,
            get_type_active_services,
            trigger_dump,
            object_system_gc,
            object_reset_cache,
            object_stack_sampling,
            object_heap_dump,
            get_dump_file_list,
            get_dump_file_content,
            get_xlog_profile,
            get_xlog_detail,
            start_counter_stream,
            start_alert_stream,
            set_log_level,
            start_mock_stream,
            get_config,
            save_config,
            save_ui_state,
            save_xlog_profile,
            list_saved_profiles,
            open_saved_profile,
            get_profile_dir,
            search_xlog_list,
            get_search_max,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
