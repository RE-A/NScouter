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

/// 파일 하나에 담을 데이터 줄 수. 엑셀 한 시트가 1,048,576줄까지라 머리글을 빼고 넉넉히 100만에서 끊는다
pub const ROWS_PER_FILE: u64 = 1_000_000;

pub struct RawSink {
    /// 첫 파일. 다음 파일은 `이름_2.csv`, `이름_3.csv` …
    path: PathBuf,
    inner: Mutex<Inner>,
    rows: AtomicU64,
    error: Mutex<Option<String>>,
    per_file: u64,
}

struct Inner {
    w: Option<BufWriter<File>>,
    /// 지금 파일 번호(1부터)와 그 파일에 쓴 줄 수
    part: u32,
    in_part: u64,
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
        // 기준 = 살펴본 시점, 과거 = 견준 지난 시점 (0.9.3 까지는 «현재 / 기준» 이었다)
        if current { "기준" } else { "과거" },
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

fn open(path: &Path) -> Result<BufWriter<File>, String> {
    let f = File::create(path).map_err(|e| format!("{} 를 만들지 못했습니다: {e}", path.display()))?;
    let mut w = BufWriter::with_capacity(1 << 20, f);
    write!(w, "{BOM}{HEADER}\r\n").map_err(|e| e.to_string())?;
    Ok(w)
}

/// n 번째 파일 경로 — 1 은 그대로, 2부터 `_n` 을 붙인다
pub fn part_path(first: &Path, n: u32) -> PathBuf {
    if n <= 1 {
        return first.to_path_buf();
    }
    let stem = first.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    first.with_file_name(format!("{stem}_{n}.csv"))
}

impl RawSink {
    pub fn create(path: &Path) -> Result<Self, String> {
        Self::with_limit(path, ROWS_PER_FILE)
    }

    pub fn with_limit(path: &Path, per_file: u64) -> Result<Self, String> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("{} 폴더를 만들지 못했습니다: {e}", dir.display()))?;
        }
        let w = open(path)?;
        Ok(Self {
            path: path.to_path_buf(),
            inner: Mutex::new(Inner { w: Some(w), part: 1, in_part: 0 }),
            rows: AtomicU64::new(0),
            error: Mutex::new(None),
            per_file: per_file.max(1),
        })
    }

    fn fail(&self, inner: &mut Inner, e: String) {
        *self.error.lock().unwrap_or_else(|p| p.into_inner()) = Some(format!("원본 CSV 쓰기 실패: {e}"));
        inner.w = None;
    }

    /// 조각 하나의 줄들을 붙인다. 파일이 차면 다음 파일로 넘어간다.
    /// 쓰기에 실패하면 그 뒤로는 쓰지 않고 까닭을 남긴다(통계는 계속한다)
    pub fn append(&self, lines: &[String]) {
        let mut g = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        for l in lines {
            if g.w.is_none() {
                return;
            }
            if g.in_part >= self.per_file {
                if let Some(mut w) = g.w.take() {
                    if let Err(e) = w.flush() {
                        self.fail(&mut g, e.to_string());
                        return;
                    }
                }
                let next = g.part + 1;
                match open(&part_path(&self.path, next)) {
                    Ok(w) => {
                        g.w = Some(w);
                        g.part = next;
                        g.in_part = 0;
                    }
                    Err(e) => {
                        self.fail(&mut g, e);
                        return;
                    }
                }
            }
            let res = g.w.as_mut().map(|w| w.write_all(l.as_bytes()));
            if let Some(Err(e)) = res {
                self.fail(&mut g, e.to_string());
                return;
            }
            g.in_part += 1;
            self.rows.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// 닫는다 — (첫 파일 경로, 줄 수, 파일 수, 실패 까닭)
    pub fn finish(&self) -> (String, u64, u32, Option<String>) {
        let mut g = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(mut w) = g.w.take() {
            if let Err(e) = w.flush() {
                *self.error.lock().unwrap_or_else(|p| p.into_inner()) = Some(format!("원본 CSV 쓰기 실패: {e}"));
            }
        }
        let err = self.error.lock().unwrap_or_else(|p| p.into_inner()).clone();
        (self.path.to_string_lossy().to_string(), self.rows.load(Ordering::Relaxed), g.part, err)
    }
}

/// CSV 한 줄의 n 번째 칸(0부터) — 따옴표로 감싼 칸과 그 안의 `""` 를 푼다
fn nth_cell(line: &str, n: usize) -> Option<String> {
    let mut i = 0;
    let mut out = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    if i == n {
                        out.push('"');
                    }
                } else {
                    quoted = false;
                }
            } else if i == n {
                out.push(c);
            }
        } else if c == '"' {
            quoted = true;
        } else if c == ',' {
            if i == n {
                return Some(out);
            }
            i += 1;
        } else if c != '\r' && c != '\n' && i == n {
            out.push(c);
        }
    }
    (i == n).then_some(out)
}

/// 원본 CSV(나뉜 파일까지)에서 **서비스 한 개**의 줄만 새 파일로 옮긴다 — 머리글은 같다. 옮긴 줄 수를 돌려준다.
/// 서비스 이름은 완전히 같아야 한다(«포함» 이 아니다)
pub fn extract_service(first: &Path, files: u32, service: &str, out: &Path) -> Result<u64, String> {
    use std::io::{BufRead, BufReader};
    let mut w = open(out)?;
    let mut n = 0u64;
    for part in 1..=files.max(1) {
        let path = part_path(first, part);
        let f = File::open(&path).map_err(|e| format!("원본 CSV 를 열지 못했습니다 ({}): {e}", path.display()))?;
        for (i, line) in BufReader::with_capacity(1 << 20, f).lines().enumerate() {
            let line = line.map_err(|e| format!("원본 CSV 읽기 실패 ({}): {e}", path.display()))?;
            if i == 0 {
                continue; // 머리글
            }
            if nth_cell(&line, 2).as_deref() == Some(service) {
                write!(w, "{line}\r\n").map_err(|e| e.to_string())?;
                n += 1;
            }
        }
    }
    w.flush().map_err(|e| e.to_string())?;
    Ok(n)
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
        assert!(l.starts_with("기준,2026-11-12 00:00:00.123,\"/a,b\",shop-1,120,1,10.0.0.1,"));
        assert!(l.ends_with(",42\r\n"));
        assert_eq!(HEADER.split(',').count(), l.replace("\"/a,b\"", "s").trim_end().split(',').count());

        let dir = std::env::temp_dir().join(format!("nscouter-raw-{}", std::process::id()));
        let path = dir.join("r.csv");
        let sink = RawSink::create(&path).unwrap();
        sink.append(std::slice::from_ref(&l));
        sink.append(&[l.clone(), l.clone()]);
        let (p, rows, files, err) = sink.finish();
        assert_eq!((rows, files, err), (3, 1, None));
        let body = std::fs::read_to_string(p).unwrap();
        assert!(body.starts_with('\u{feff}'));
        assert_eq!(body.lines().count(), 4);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn 파일이_차면_다음_파일로_넘어가고_파일마다_머리글이_있다() {
        let dir = std::env::temp_dir().join(format!("nscouter-raw-split-{}", std::process::id()));
        let path = dir.join("x.csv");
        let sink = RawSink::with_limit(&path, 2).unwrap();
        let ls: Vec<String> = (0..5).map(|i| format!("{i}\r\n")).collect();
        sink.append(&ls[..3]);
        sink.append(&ls[3..]);
        let (_, rows, files, err) = sink.finish();
        assert_eq!((rows, files, err), (5, 3, None));
        let read = |n: u32| std::fs::read_to_string(part_path(&path, n)).unwrap();
        assert_eq!(read(1).lines().skip(1).collect::<Vec<_>>(), ["0", "1"]);
        assert_eq!(read(2).lines().skip(1).collect::<Vec<_>>(), ["2", "3"]);
        assert_eq!(read(3).lines().skip(1).collect::<Vec<_>>(), ["4"]);
        assert!(read(3).starts_with('\u{feff}'));
        assert_eq!(part_path(&path, 2).file_name().unwrap(), "x_2.csv");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn 서비스_한_개의_줄만_나뉜_파일까지_옮긴다() {
        let dir = std::env::temp_dir().join(format!("nscouter-raw-extract-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let first = dir.join("raw.csv");
        let sink = RawSink::with_limit(&first, 2).unwrap();
        let x = XLogPack { end_time: 1_794_441_600_123, elapsed: 120, ..XLogPack::default() };
        sink.append(&[
            line(true, &x, "/a,b", "s1", 0),
            line(true, &x, "/a", "s1", 0),
            line(false, &x, "/a,b", "s2", 0),
            line(false, &x, "/a,bc", "s2", 0),
            line(true, &x, "/a,b", "s3", 0),
        ]);
        let (_, rows, files, err) = sink.finish();
        assert_eq!((rows, files, err), (5, 3, None));
        let out = dir.join("one.csv");
        assert_eq!(extract_service(&first, files, "/a,b", &out).unwrap(), 3);
        let body = std::fs::read_to_string(&out).unwrap();
        let lines: Vec<&str> = body.split("\r\n").filter(|l| !l.is_empty()).collect();
        assert_eq!(lines.len(), 4);
        assert!(lines[0].ends_with(HEADER));
        assert!(lines[1..].iter().all(|l| l.contains(",\"/a,b\",")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn 칸_꺼내기는_따옴표를_푼다() {
        assert_eq!(nth_cell("기준,t,\"say \"\"hi\"\", x\",s", 2).as_deref(), Some("say \"hi\", x"));
        assert_eq!(nth_cell("a,b,c", 2).as_deref(), Some("c"));
        assert_eq!(nth_cell("a,b", 2), None);
    }
}
