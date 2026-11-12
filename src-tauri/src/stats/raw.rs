// 원본 CSV — 통계에 들어간 트랜잭션을 한 건 한 줄로 파일에 흘려 쓴다
//
// 하루치면 천만 건이 넘을 수 있어 **메모리에 모으지 않는다.** 조각(5분) 하나를 다 받으면 그 조각의 줄을
// 한 번에 붙인다 — 조각이 중간에 실패해 다시 받을 때 앞서 받은 일부가 두 번 들어가지 않게.
// 줄 순서는 조각이 끝난 순서라 시각순이 아니다(엑셀에서 정렬한다).

use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use crate::scouter::objtype::civil_from_days;
use crate::scouter::pack::XLogPack;

/// 엑셀은 BOM 이 없으면 UTF-8 한글을 못 알아본다
const BOM: &str = "\u{feff}";

pub const HEADER: &str = "구분,종료 시각,서비스,서버,응답(ms),에러,IP,SQL 횟수,SQL(ms),API 횟수,API(ms),CPU(ms),HTTP 상태,txid";

pub struct RawSink {
    path: PathBuf,
    w: Mutex<Option<BufWriter<File>>>,
    rows: AtomicU64,
    error: Mutex<Option<String>>,
}

/// CSV 한 칸 — 쉼표·따옴표·줄바꿈이 있으면 감싸고 따옴표는 두 번 쓴다(RFC 4180)
pub fn cell(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// 화면 시간대의 `yyyy-mm-dd HH:MM:SS.mmm`
pub fn local_time(ms: i64, tz_offset_ms: i64) -> String {
    const DAY: i64 = 86_400_000;
    let t = ms + tz_offset_ms;
    let (y, m, d) = civil_from_days(t.div_euclid(DAY));
    let r = t.rem_euclid(DAY);
    format!("{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02}.{:03}", r / 3_600_000, r / 60_000 % 60, r / 1000 % 60, r % 1000)
}

/// 파일 이름용 `yyyymmdd-HHMMSS` (화면 시간대)
pub fn file_stamp(ms: i64, tz_offset_ms: i64) -> String {
    let s = local_time(ms, tz_offset_ms);
    format!("{}{}{}-{}{}{}", &s[0..4], &s[5..7], &s[8..10], &s[11..13], &s[14..16], &s[17..19])
}

/// 트랜잭션 한 건의 줄 (끝에 줄바꿈 포함)
pub fn line(current: bool, x: &XLogPack, service: &str, server: &str, tz_offset_ms: i64) -> String {
    format!(
        "{},{},{},{},{},{},{},{},{},{},{},{},{},{}\r\n",
        if current { "현재" } else { "기준" },
        local_time(x.end_time, tz_offset_ms),
        cell(service),
        cell(server),
        x.elapsed,
        i32::from(x.error != 0),
        cell(&x.ipaddr),
        x.sql_count,
        x.sql_time,
        x.apicall_count,
        x.apicall_time,
        x.cpu,
        x.status,
        x.txid,
    )
}

impl RawSink {
    pub fn create(path: &Path) -> Result<Self, String> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("{} 폴더를 만들지 못했습니다: {e}", dir.display()))?;
        }
        let f = File::create(path).map_err(|e| format!("{} 를 만들지 못했습니다: {e}", path.display()))?;
        let mut w = BufWriter::with_capacity(1 << 20, f);
        write!(w, "{BOM}{HEADER}\r\n").map_err(|e| e.to_string())?;
        Ok(Self { path: path.to_path_buf(), w: Mutex::new(Some(w)), rows: AtomicU64::new(0), error: Mutex::new(None) })
    }

    /// 조각 하나의 줄들을 붙인다. 쓰기에 실패하면 그 뒤로는 쓰지 않고 까닭을 남긴다(통계는 계속한다)
    pub fn append(&self, chunk: &str, n: u64) {
        if chunk.is_empty() {
            return;
        }
        let mut g = self.w.lock().unwrap_or_else(|p| p.into_inner());
        let Some(w) = g.as_mut() else { return };
        match w.write_all(chunk.as_bytes()) {
            Ok(()) => {
                self.rows.fetch_add(n, Ordering::Relaxed);
            }
            Err(e) => {
                *self.error.lock().unwrap_or_else(|p| p.into_inner()) = Some(format!("원본 CSV 쓰기 실패: {e}"));
                *g = None;
            }
        }
    }

    /// 닫는다 — (경로, 줄 수, 실패 까닭)
    pub fn finish(&self) -> (String, u64, Option<String>) {
        if let Some(mut w) = self.w.lock().unwrap_or_else(|p| p.into_inner()).take() {
            if let Err(e) = w.flush() {
                *self.error.lock().unwrap_or_else(|p| p.into_inner()) = Some(format!("원본 CSV 쓰기 실패: {e}"));
            }
        }
        let err = self.error.lock().unwrap_or_else(|p| p.into_inner()).clone();
        (self.path.to_string_lossy().to_string(), self.rows.load(Ordering::Relaxed), err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 쉼표_따옴표가_든_칸은_감싼다() {
        assert_eq!(cell("/a"), "/a");
        assert_eq!(cell("/a,b"), "\"/a,b\"");
        assert_eq!(cell("say \"hi\""), "\"say \"\"hi\"\"\"");
    }

    #[test]
    fn 시각은_화면_시간대로_적는다() {
        // 2026-11-12 00:00:00.123 UTC → KST 09:00:00.123
        let ms = 1_794_441_600_123;
        assert_eq!(local_time(ms, 9 * 3600 * 1000), "2026-11-12 09:00:00.123");
        assert_eq!(file_stamp(ms + 3_723_000, 0), "20261112-010203");
    }

    #[test]
    fn 머리글_칸_수와_줄_칸_수가_같고_조각_단위로_붙는다() {
        let x = XLogPack { end_time: 1_794_441_600_123, elapsed: 120, error: 1, ipaddr: "10.0.0.1".into(), txid: 42, ..XLogPack::default() };
        let l = line(true, &x, "/a,b", "shop-1", 0);
        assert!(l.starts_with("현재,2026-11-12 00:00:00.123,\"/a,b\",shop-1,120,1,10.0.0.1,"));
        assert!(l.ends_with(",42\r\n"));
        assert_eq!(HEADER.split(',').count(), l.replace("\"/a,b\"", "s").trim_end().split(',').count());

        let dir = std::env::temp_dir().join(format!("nscouter-raw-{}", std::process::id()));
        let path = dir.join("r.csv");
        let sink = RawSink::create(&path).unwrap();
        sink.append(&l, 1);
        sink.append(&format!("{l}{l}"), 2);
        let (p, rows, err) = sink.finish();
        assert_eq!((rows, err), (3, None));
        let body = std::fs::read_to_string(p).unwrap();
        assert!(body.starts_with('\u{feff}'));
        assert_eq!(body.lines().count(), 4);
        let _ = std::fs::remove_dir_all(dir);
    }
}
