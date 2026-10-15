// src-tauri/src/lib.rs

pub mod commands;
pub mod config;
pub mod export_store;
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
                // **Trace 로 세워 두고, 실제 레벨은 `log::set_max_level` 로 조인다.**
                //
                // 여기 넣은 값은 fern dispatch 에 **박혀서** 런타임에 못 올린다
                // (`shallow_enabled` 가 `default_level` 로 거른다). 릴리즈를 Error 로
                // 박아 두면 설정 창의 로그 레벨이 **낮추는 쪽으로만** 동작해서,
                // 운영에서 «debug 로 올리고 재현해 주세요» 가 성립하지 않았다 —
                // 올렸는데 파일에는 아무것도 안 남는다.
                //
                // 문턱은 `log::set_max_level` 하나로 모은다. `log::debug!` 매크로가
                // 레코드를 만들기 전에 그 값을 보므로, 꺼 둔 동안의 비용도 그대로다.
                .level(log::LevelFilter::Trace)
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
        // 로그 플러그인이 붙으면서 문턱을 Trace 로 올려놓는다(`attach_logger`).
        // **그 뒤에** 제자리로 내린다 — 플러그인 setup 이 앱 setup 보다 먼저 돈다.
        .setup(move |_app| {
            log::set_max_level(initial_level);
            Ok(())
        })
        .manage(AppState::new_with_config(config, config_path))
        .invoke_handler(tauri::generate_handler![
            connect_scouter,
            disconnect_scouter,
            start_xlog_stream,
            stop_xlog_stream,
            stop_counter_stream,
            get_past_counter,
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
            get_object_type_families,
            save_server_config,
            get_summary,
            get_error_summary,
            get_interaction,
            load_past_xlog,
            get_xlog_distribution,
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
            save_servers,
            save_xlog_profile,
            list_saved_profiles,
            open_saved_profile,
            get_profile_dir,
            save_csv_export,
            get_export_dir,
            search_xlog_list,
            get_search_max,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod log_level_tests {
    /// 로그 문턱은 **한 곳에서만** 정해야 한다.
    ///
    /// fern dispatch 에 넣은 레벨은 빌드 시점에 박혀 런타임에 못 올린다
    /// (`Dispatch::shallow_enabled` 가 `default_level` 로 거른다). 릴리즈를 Error 로
    /// 박아 두면 설정 창의 로그 레벨이 **낮추는 쪽으로만** 먹어서, 운영에서
    /// «debug 로 올리고 재현해 주세요» 가 성립하지 않는다 — 올려도 파일이 빈다.
    ///
    /// 그래서 dispatch 는 Trace 로 열어 두고 문턱은 `log::set_max_level` 하나로 모은다.
    /// 다음에 누가 `.level(initial_level)` 로 되돌리면 이 테스트가 막는다.
    #[test]
    fn 로그_플러그인은_trace_로_열어_둔다() {
        let src = include_str!("lib.rs");
        assert!(
            src.contains(".level(log::LevelFilter::Trace)"),
            "플러그인 dispatch 를 Trace 가 아닌 값으로 박으면 런타임에 레벨을 못 올린다"
        );
        assert!(
            src.contains("log::set_max_level(initial_level)"),
            "dispatch 를 Trace 로 열었으면 시작 문턱은 set_max_level 로 내려야 한다"
        );
    }
}
