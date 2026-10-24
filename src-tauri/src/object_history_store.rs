// 오브젝트 기록(`objectTimeline.ts`)을 **껐다 켜도 남게** 두는 자리
//
// 콜렉터는 Task 가 처음 뜬 때를 어디에도 안 남긴다(`wakeup` 은 하트비트마다 덮인다). 그래서
// «언제 보였고 언제까지 살았나» 는 이 앱이 본 것을 적어 둔 것뿐이다. 앱을 다시 켜면 그 기록이
// 비어 — 껐던 사이가 아니라 **켜기 전까지 본 것까지** 잃는다. 알림 묶기(교체/장애)와 과거 조회의
// Task 고르기가 그 기록을 쓴다.
//
// 이 모듈은 **봉투와 파일 이름만** 안다 (`profile_store.rs` 와 같은 까닭). 알맹이(`objects`)는
// 화면이 만든 JSON 을 그대로 통과시킨다. 무엇을 남길지(며칠치·몇 건)도 화면이 정한다.
//
// **서버마다 한 파일이다.** 오브젝트 해시는 이름의 해시라 콜렉터가 달라도 겹친다(F-35) — 섞이면
// 다른 서버의 Task 가 «그때 살아 있었다» 로 끼어 교체/장애 판정이 틀린다. `server_id` 는 콜렉터
// 설정값이라 두 콜렉터가 같을 수 있어 **호스트·포트까지** 이름에 넣는다.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::profile_store::sanitize;

/// 폴더 이름. `{data_dir}/object-history/`
pub const DIR_NAME: &str = "object-history";

/// 봉투 형식 이름
pub const FORMAT: &str = "nscouter-object-history";

/// 봉투 판. 알맹이 모양이 바뀌면 올린다 — 다른 판은 안 읽는다(처음부터 다시 쌓는다)
pub const VERSION: u32 = 1;

/// 이보다 큰 파일은 안 읽는다. 화면이 몇천 건으로 자르므로 정상이면 1MB 안쪽이다
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;

/// 파일에 실제로 들어가는 모양.
#[derive(Debug, Serialize, Deserialize)]
pub struct SavedObjectHistory {
    pub format: String,
    pub version: u32,
    /// 저장한 시각(ms)
    pub saved_at: i64,
    /// 어느 서버의 기록인가 — 사람이 파일을 열었을 때 알아보게
    pub host: String,
    pub port: u16,
    pub server_id: String,
    pub objects: Value,
}

/// 서버 하나의 파일 이름. `10.0.0.5_6100_SERVER.json`
pub fn file_name(host: &str, port: u16, server_id: &str) -> String {
    format!("{}_{}_{}.json", sanitize(host), port, sanitize(server_id))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 남긴다. **임시 파일에 쓰고 바꿔 끼운다** — 쓰는 도중에 앱이 꺼져도 지난 기록은 성하다.
pub fn save(dir: &Path, host: &str, port: u16, server_id: &str, objects: Value) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| format!("{} 폴더를 만들지 못했습니다: {e}", dir.display()))?;
    let saved = SavedObjectHistory {
        format: FORMAT.to_string(),
        version: VERSION,
        saved_at: now_ms(),
        host: host.to_string(),
        port,
        server_id: server_id.to_string(),
        objects,
    };
    let path = dir.join(file_name(host, port, server_id));
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_vec(&saved).map_err(|e| format!("직렬화 실패: {e}"))?;
    fs::write(&tmp, body).map_err(|e| format!("{} 에 쓰지 못했습니다: {e}", tmp.display()))?;
    fs::rename(&tmp, &path).map_err(|e| format!("{} 로 바꾸지 못했습니다: {e}", path.display()))?;
    Ok(path)
}

/// 읽는다. 없거나·깨졌거나·우리 봉투가 아니거나·판이 다르면 `None` — 처음부터 다시 쌓으면 된다.
pub fn load(dir: &Path, host: &str, port: u16, server_id: &str) -> Option<Value> {
    let path = dir.join(file_name(host, port, server_id));
    let meta = fs::metadata(&path).ok()?;
    if meta.len() > MAX_FILE_BYTES {
        log::warn!("오브젝트 기록이 너무 커서 안 읽습니다: {} ({} bytes)", path.display(), meta.len());
        return None;
    }
    let bytes = fs::read(&path).ok()?;
    let saved: SavedObjectHistory = match serde_json::from_slice(&bytes) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("오브젝트 기록을 못 읽었습니다: {} — {e}", path.display());
            return None;
        }
    };
    if saved.format != FORMAT || saved.version != VERSION {
        return None;
    }
    Some(saved.objects)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("nscouter-objhist-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn 저장하면_그대로_다시_읽힌다() {
        let dir = temp_dir("roundtrip");
        let objects = json!([{ "obj_hash": 1, "obj_name": "/vm/safs-1" }]);
        save(&dir, "10.0.0.5", 6100, "SERVER", objects.clone()).unwrap();
        assert_eq!(load(&dir, "10.0.0.5", 6100, "SERVER"), Some(objects));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 서버마다_따로다_server_id_가_같아도_호스트가_다르면_다른_파일이다() {
        let dir = temp_dir("per-server");
        save(&dir, "10.0.0.5", 6100, "SERVER", json!([1])).unwrap();
        save(&dir, "10.0.0.6", 6100, "SERVER", json!([2])).unwrap();
        assert_eq!(load(&dir, "10.0.0.5", 6100, "SERVER"), Some(json!([1])));
        assert_eq!(load(&dir, "10.0.0.6", 6100, "SERVER"), Some(json!([2])));
        assert_eq!(load(&dir, "10.0.0.5", 6101, "SERVER"), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 없거나_깨졌거나_판이_다르면_없는_것으로_친다() {
        let dir = temp_dir("broken");
        assert_eq!(load(&dir, "h", 1, "s"), None);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(file_name("h", 1, "s")), b"{not json").unwrap();
        assert_eq!(load(&dir, "h", 1, "s"), None);
        let other = json!({ "format": FORMAT, "version": VERSION + 1, "saved_at": 0, "host": "h", "port": 1, "server_id": "s", "objects": [] });
        fs::write(dir.join(file_name("h", 1, "s")), serde_json::to_vec(&other).unwrap()).unwrap();
        assert_eq!(load(&dir, "h", 1, "s"), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 파일_이름에_경로_글자가_안_들어간다() {
        assert_eq!(file_name("a/b", 6100, "x:y"), "a_b_6100_x_y.json");
    }
}
