// 프로파일을 파일로 남기고 다시 여는 자리
//
// **왜 JSON 한 파일인가.** ASIS 는 워크스페이스 아래에 `xlog.xlog`(XLogPack)와
// `xlog.prof`(스텝 blob)를 와이어 포맷 그대로 떨군다. 그 파일은 해시가 안 풀린
// 상태라 **열 때 콜렉터의 텍스트 사전이 다시 필요하다** — 며칠 뒤 사전이 밀려나거나
// 다른 서버에서 열면 이름이 안 나온다. 화면은 이미 사전을 풀어 들고 있으므로
// 푼 채로 같이 저장한다. 그러면 접속 없이도 그대로 열린다.
//
// 이 모듈은 **봉투와 파일 이름만** 안다. 알맹이(`xlog`/`profile`/`texts`)는
// 화면이 만든 JSON 을 그대로 통과시킨다 — 스키마를 여기에 한 번 더 적으면
// 화면 타입이 바뀔 때마다 두 곳을 고쳐야 한다.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 폴더 이름. `{data_dir}/profiles/`
pub const DIR_NAME: &str = "profiles";

/// 봉투 형식 이름. 다른 JSON 을 열었을 때 «이건 우리 것이 아니다» 를 말해 준다.
pub const FORMAT: &str = "nscouter-profile";

/// 봉투 판. 알맹이 모양이 바뀌면 올린다.
pub const VERSION: u32 = 1;

/// 목록을 그릴 때 파일 하나를 통째로 읽는다. 터무니없이 큰 것은 건너뛴다.
const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;

/// 파일 이름에 넣는 서비스명의 최대 길이 (ASIS SaveProfileJob 과 같은 80자)
const MAX_SERVICE_IN_NAME: usize = 80;

/// 화면이 넘겨 주는 저장 요청.
#[derive(Debug, Deserialize)]
pub struct SaveProfileInput {
    /// 서비스명. 파일 이름에 들어간다
    pub service: String,
    /// 트랜잭션 id. 문자열이다 — i64 가 JS 수 범위를 넘는다
    pub txid: String,
    /// 트랜잭션 종료 시각(ms). 봉투에 남겨 열 때 보여 준다
    pub end_time: i64,
    /// 파일 이름에 쓸 `yyyymmdd-HHmmss`.
    ///
    /// **화면이 만들어 넘긴다.** 이 앱은 날짜 계산을 프론트에서 한다 —
    /// Rust 쪽에 시간 라이브러리를 두지 않는 기존 결정을 따른다(chrono 는 dev 전용).
    pub stamp: String,
    pub xlog: Value,
    pub profile: Value,
    pub texts: Value,
}

/// 파일에 실제로 들어가는 모양.
#[derive(Debug, Serialize, Deserialize)]
pub struct SavedProfile {
    pub format: String,
    pub version: u32,
    /// 저장한 시각(ms)
    pub saved_at: i64,
    pub service: String,
    pub txid: String,
    pub end_time: i64,
    pub xlog: Value,
    pub profile: Value,
    pub texts: Value,
}

/// 목록 한 줄.
#[derive(Debug, Serialize)]
pub struct SavedProfileEntry {
    pub path: String,
    pub file_name: String,
    pub service: String,
    pub txid: String,
    pub end_time: i64,
    pub saved_at: i64,
    pub size: u64,
}

/// 파일 이름에 쓸 수 없는 글자를 눕힌다.
///
/// 저장본 말고 **내보내기(csv)도 같은 규칙**을 쓴다 — 규칙이 갈라지면
/// 한쪽에서만 만들어지지 않는 파일 이름이 생긴다.
///
/// 서비스명은 `/shop/order<GET>` 처럼 오므로 그대로 쓰면 경로가 되거나
/// 윈도에서 만들어지지 않는다. **자르기 전에 바꾼다** — 잘린 끝에 남은
/// 반쪽짜리 글자로 이름이 갈리지 않게.
pub(crate) fn sanitize(service: &str) -> String {
    let cleaned: String = service
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim_matches(['_', ' ', '.']).to_string();
    let short: String = trimmed.chars().take(MAX_SERVICE_IN_NAME).collect();
    if short.is_empty() {
        "unknown".to_string()
    } else {
        short
    }
}

/// 저장 파일 이름. `20260830-141203_shop_order_GET_<txid>.json`
pub fn file_name(input: &SaveProfileInput) -> String {
    format!(
        "{}_{}_{}.json",
        sanitize(&input.stamp),
        sanitize(&input.service),
        sanitize(&input.txid),
    )
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 저장한다. 돌려주는 값은 만들어진 파일의 전체 경로다.
pub fn save(dir: &Path, input: SaveProfileInput) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| format!("{} 폴더를 만들지 못했습니다: {e}", dir.display()))?;

    let saved = SavedProfile {
        format: FORMAT.to_string(),
        version: VERSION,
        saved_at: now_ms(),
        service: input.service.clone(),
        txid: input.txid.clone(),
        end_time: input.end_time,
        xlog: input.xlog.clone(),
        profile: input.profile.clone(),
        texts: input.texts.clone(),
    };

    let path = dir.join(file_name(&input));
    let body = serde_json::to_vec_pretty(&saved).map_err(|e| format!("직렬화 실패: {e}"))?;
    fs::write(&path, body).map_err(|e| format!("{} 에 쓰지 못했습니다: {e}", path.display()))?;
    Ok(path)
}

/// 폴더의 저장본 목록. **최신 저장 순**이다.
///
/// 우리 봉투가 아닌 `.json` 은 조용히 건너뛴다 — 같은 폴더에 다른 파일을 둘 수 있다.
pub fn list(dir: &Path) -> Vec<SavedProfileEntry> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new(); // 폴더가 아직 없으면 저장본도 없다
    };

    let mut rows: Vec<SavedProfileEntry> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
            continue;
        }
        let Ok(saved) = read_file(&path) else { continue };
        rows.push(SavedProfileEntry {
            path: path.to_string_lossy().to_string(),
            file_name: path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            service: saved.service,
            txid: saved.txid,
            end_time: saved.end_time,
            saved_at: saved.saved_at,
            size: meta.len(),
        });
    }

    rows.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
    rows
}

/// 파일 하나를 읽어 봉투를 확인한다.
pub fn read_file(path: &Path) -> Result<SavedProfile, String> {
    let body = fs::read(path).map_err(|e| format!("{} 를 읽지 못했습니다: {e}", path.display()))?;
    let saved: SavedProfile =
        serde_json::from_slice(&body).map_err(|e| format!("저장본 형식이 아닙니다: {e}"))?;
    if saved.format != FORMAT {
        return Err(format!("저장본 형식이 아닙니다: format={}", saved.format));
    }
    // 판이 올라간 파일은 **모르는 채로 읽지 않는다.** 알맹이 모양이 다를 수 있다.
    if saved.version > VERSION {
        return Err(format!(
            "더 새로운 판({})의 저장본입니다. 앱을 올려 주세요",
            saved.version
        ));
    }
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn input(service: &str, txid: &str) -> SaveProfileInput {
        SaveProfileInput {
            service: service.to_string(),
            txid: txid.to_string(),
            end_time: 1_786_721_179_122,
            stamp: "20260830-141203".to_string(),
            xlog: json!({ "txid": txid, "elapsed": 6006 }),
            profile: json!({ "steps": [{ "kind": "Sql", "hash": 7 }] }),
            texts: json!({ "7": "select 1" }),
        }
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nscouter-profile-{tag}-{}", now_ms()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn 파일_이름에_경로_글자가_남지_않는다() {
        // `/shop/order<GET>` 를 그대로 쓰면 폴더가 되거나 윈도에서 아예 안 만들어진다.
        let name = file_name(&input("/shop/lab/slow<GET>", "z1pa9p0"));
        assert!(!name.contains('/'), "{name}");
        assert!(!name.contains('<') && !name.contains('>'), "{name}");
        assert!(name.ends_with(".json"), "{name}");
        assert!(name.contains("shop_lab_slow_GET"), "{name}");
        assert!(name.starts_with("20260830-141203_"), "{name}");
    }

    #[test]
    fn 서비스명이_길어도_이름이_터지지_않는다() {
        let long = format!("/{}", "a".repeat(300));
        let name = file_name(&input(&long, "z1"));
        // 날짜(15) + 밑줄 2 + 서비스 80 + txid + .json
        assert!(name.len() < 130, "이름이 너무 길다: {}", name.len());
    }

    #[test]
    fn 서비스명이_전부_특수문자면_unknown_이다() {
        let name = file_name(&input("///", "z1"));
        assert!(name.contains("unknown"), "{name}");
    }

    #[test]
    fn 저장한_것을_그대로_다시_읽는다() {
        let dir = temp_dir("roundtrip");
        let path = save(&dir, input("/shop/order", "z1pa9p0")).expect("저장 실패");

        let back = read_file(&path).expect("읽기 실패");
        assert_eq!(back.format, FORMAT);
        assert_eq!(back.version, VERSION);
        assert_eq!(back.service, "/shop/order");
        assert_eq!(back.txid, "z1pa9p0");
        // 알맹이는 통과만 시킨다 — 넣은 그대로 나와야 한다
        assert_eq!(back.texts, json!({ "7": "select 1" }));
        assert_eq!(back.xlog["elapsed"], 6006);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 목록은_최신_저장_순이다() {
        let dir = temp_dir("list");
        // 같은 시각의 두 건이면 이름이 겹치므로 txid 로 가른다
        save(&dir, input("/shop/a", "z1")).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        save(&dir, input("/shop/b", "z2")).unwrap();

        let rows = list(&dir);
        assert_eq!(rows.len(), 2);
        assert!(rows[0].saved_at >= rows[1].saved_at, "최신이 위가 아니다");
        assert_eq!(rows[0].service, "/shop/b");
        assert!(rows[0].size > 0);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 남의_json_은_목록에서_빠진다() {
        let dir = temp_dir("foreign");
        save(&dir, input("/shop/a", "z1")).unwrap();
        fs::write(dir.join("something-else.json"), b"{\"hello\":1}").unwrap();

        let rows = list(&dir);
        assert_eq!(rows.len(), 1, "우리 봉투만 세야 한다");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 폴더가_없으면_빈_목록이다() {
        // 한 번도 저장하지 않은 앱에서 목록을 열면 여기로 온다. 에러가 아니다.
        assert!(list(&temp_dir("missing")).is_empty());
    }

    #[test]
    fn 더_새로운_판은_읽지_않는다() {
        let dir = temp_dir("version");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("future.json");
        let body = json!({
            "format": FORMAT, "version": VERSION + 1, "saved_at": 1, "service": "/x",
            "txid": "z1", "end_time": 1, "xlog": {}, "profile": {}, "texts": {}
        });
        fs::write(&path, serde_json::to_vec(&body).unwrap()).unwrap();

        let err = read_file(&path).expect_err("더 새로운 판을 읽어 버렸다");
        assert!(err.contains("판"), "{err}");

        let _ = fs::remove_dir_all(&dir);
    }
}
