// 로그 문턱을 **런타임에 올릴 수 있는가.**
//
// 운영에서 «debug 로 올리고 재현해 주세요» 가 성립하려면 이게 되어야 한다.
// 그런데 `tauri_plugin_log::Builder::level()` 에 넣은 값은 fern dispatch 에 박혀서
// 런타임에 못 올린다 — `Dispatch::shallow_enabled` 가 `default_level` 로 거르고,
// `log::set_max_level` 은 그보다 **낮추는 쪽으로만** 효과가 있다.
// 릴리즈를 Error 로 박아 두니 헤더에서 DEBUG 로 바꿔도 파일이 그대로 비어 있었다.
//
// 그래서 dispatch 는 Trace 로 열고 문턱은 `log::set_max_level` 하나로 모았다.
// 여기서는 **그 조합이 실제로 양쪽으로 움직이는지**를 진짜 fern 으로 확인한다
// (버전은 tauri-plugin-log 이 쓰는 것과 같게 Cargo.lock 에 고정돼 있다).

use std::io::Read;
use std::sync::{Arc, Mutex};

/// fern 이 쓴 바이트를 그대로 들고 있는 통. 파일 대신 이걸로 받아 바로 읽는다.
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

impl Read for Sink {
    fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
        Ok(0)
    }
}

impl Sink {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.0.lock().unwrap()).to_string()
    }
}

/// 전역 로거는 프로세스당 한 번만 세울 수 있다. 그래서 이 파일에 시험은 하나다.
#[test]
fn dispatch_를_trace_로_열면_문턱을_런타임에_올릴_수_있다() {
    let sink = Sink::default();

    // lib.rs 가 하는 것과 같은 모양: dispatch 는 Trace, 시작 문턱은 set_max_level.
    let (max_level, logger) = fern::Dispatch::new()
        .level(log::LevelFilter::Trace)
        .format(|out, message, record| out.finish(format_args!("[{}] {}", record.level(), message)))
        .chain(Box::new(sink.clone()) as Box<dyn std::io::Write + Send>)
        .into_log();

    log::set_boxed_logger(logger).expect("로거는 한 번만 세운다");
    log::set_max_level(max_level);

    // ── 1. 릴리즈 기본값으로 내린다 ────────────────────────────
    log::set_max_level(log::LevelFilter::Error);
    log::debug!("꺼져 있을 때의 디버그");
    log::error!("꺼져 있을 때의 에러");

    let after_quiet = sink.text();
    assert!(
        !after_quiet.contains("꺼져 있을 때의 디버그"),
        "Error 문턱에서 디버그가 새어 나왔다: {after_quiet}"
    );
    assert!(
        after_quiet.contains("꺼져 있을 때의 에러"),
        "Error 문턱인데 에러도 안 남았다: {after_quiet}"
    );

    // ── 2. 런타임에 올린다 — 여기가 깨져 있던 자리다 ──────────
    log::set_max_level(log::LevelFilter::Debug);
    log::debug!("올린 뒤의 디버그");

    let after_raise = sink.text();
    assert!(
        after_raise.contains("올린 뒤의 디버그"),
        "문턱을 Debug 로 올렸는데 안 남았다 — dispatch 에 레벨이 박혀 있다: {after_raise}"
    );

    // ── 3. 다시 내리면 다시 조용해진다 ────────────────────────
    log::set_max_level(log::LevelFilter::Error);
    log::debug!("내린 뒤의 디버그");

    assert!(
        !sink.text().contains("내린 뒤의 디버그"),
        "문턱을 되돌렸는데 계속 남는다 — 운영에서 파일이 끝없이 커진다"
    );
}
