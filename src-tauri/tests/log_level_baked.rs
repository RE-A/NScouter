// 옛 모양이 **왜 안 됐는지**를 남겨 둔다.
//
// `tauri_plugin_log::Builder::level(Error)` 는 fern dispatch 의 `default_level` 이 되고,
// 그 값은 `Dispatch::shallow_enabled` 가 레코드마다 본다. `log::set_max_level` 로는
// 그 문턱을 **넘을 수 없다** — 매크로 쪽 게이트를 열어 줄 뿐이고, 거르는 쪽은 그대로다.
// 릴리즈에서 헤더의 DEBUG 가 먹지 않던 실체가 이것이다.
//
// 전역 로거는 프로세스당 한 번만 세울 수 있어서 `log_level.rs` 와 파일을 나눈다
// (통합 테스트는 파일마다 따로 실행된다).

use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
struct Sink(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for Sink {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Sink {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.0.lock().unwrap()).to_string()
    }
}

#[test]
fn dispatch_에_레벨을_박으면_런타임에_못_올린다() {
    let sink = Sink::default();

    // 옛 모양: 릴리즈 기본값 Error 를 dispatch 에 박는다.
    let (max_level, logger) = fern::Dispatch::new()
        .level(log::LevelFilter::Error)
        .format(|out, message, record| out.finish(format_args!("[{}] {}", record.level(), message)))
        .chain(Box::new(sink.clone()) as Box<dyn std::io::Write + Send>)
        .into_log();

    log::set_boxed_logger(logger).expect("로거는 한 번만 세운다");
    log::set_max_level(max_level);

    // 사용자가 화면에서 DEBUG 를 고른 것과 같다.
    log::set_max_level(log::LevelFilter::Debug);
    log::debug!("올리려 해도 안 남는 디버그");
    log::error!("에러는 남는다");

    let out = sink.text();
    assert!(
        !out.contains("올리려 해도 안 남는 디버그"),
        "박아 둔 레벨을 넘어섰다 — fern 동작이 바뀌었다면 lib.rs 의 Trace 우회를 다시 볼 것"
    );
    assert!(out.contains("에러는 남는다"), "에러까지 사라지면 다른 문제다: {out}");
}
