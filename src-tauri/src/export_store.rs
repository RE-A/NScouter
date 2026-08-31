// 표를 파일로 내보내는 자리
//
// 요약 표는 화면에 상위 50줄만 그린다. **받아 온 행은 그보다 훨씬 많다** —
// 「무엇이 시간을 먹었나」를 남에게 넘기거나 엑셀에서 더 따져 보려면 전부가 필요하다.
//
// ASIS 는 `EXPORT_APP_SUMMARY` 로 서버에 다시 묻지만, 우리는 이미 그 행을 다 갖고
// 있다. 다시 묻지 않고 화면이 만든 것을 그대로 쓴다.
//
// 파일 이름 규칙은 저장본(`profile_store`)과 같은 `sanitize` 를 쓴다.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::profile_store::sanitize;

/// 폴더 이름. `{data_dir}/exports/`
pub const DIR_NAME: &str = "exports";

/// **엑셀은 BOM 이 없으면 UTF-8 을 못 알아본다.** 한글이 깨져 나온다.
const BOM: &str = "\u{feff}";

#[derive(Debug, Deserialize)]
pub struct SaveCsvInput {
    /// 무엇을 내보내는지. 파일 이름 가운데에 들어간다 (예: `summary-service`)
    pub name: String,
    /// 파일 이름에 쓸 `yyyymmdd-HHmmss`. 화면이 만들어 넘긴다
    pub stamp: String,
    /// 첫 줄이 머리글인 CSV 본문. **BOM 은 여기서 붙인다**
    pub csv: String,
}

/// 내보내기 파일 이름. `20260830-141203_summary-service.csv`
pub fn file_name(input: &SaveCsvInput) -> String {
    format!("{}_{}.csv", sanitize(&input.stamp), sanitize(&input.name))
}

/// 저장한다. 돌려주는 값은 만들어진 파일의 전체 경로다.
pub fn save(dir: &Path, input: SaveCsvInput) -> Result<PathBuf, String> {
    if input.csv.is_empty() {
        // 빈 파일을 만들어 두면 «내보냈다» 는 말과 파일이 어긋난다.
        return Err("내보낼 내용이 없습니다".to_string());
    }
    fs::create_dir_all(dir).map_err(|e| format!("{} 폴더를 만들지 못했습니다: {e}", dir.display()))?;

    let path = dir.join(file_name(&input));
    let body = format!("{BOM}{}", input.csv);
    fs::write(&path, body.as_bytes())
        .map_err(|e| format!("{} 에 쓰지 못했습니다: {e}", path.display()))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(name: &str, csv: &str) -> SaveCsvInput {
        SaveCsvInput {
            name: name.to_string(),
            stamp: "20260830-141203".to_string(),
            csv: csv.to_string(),
        }
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("nscouter-export-{tag}-{n}"));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn 이름에_경로_글자가_남지_않는다() {
        let name = file_name(&input("summary/service<GET>", "a"));
        assert!(!name.contains('/') && !name.contains('<'), "{name}");
        assert!(name.starts_with("20260830-141203_"), "{name}");
        assert!(name.ends_with(".csv"), "{name}");
    }

    #[test]
    fn 엑셀이_한글을_읽게_bom_을_붙인다() {
        // BOM 이 없으면 엑셀이 UTF-8 을 못 알아보고 한글이 깨진다.
        let dir = temp_dir("bom");
        let path = save(&dir, input("summary-service", "이름,횟수\n/shop/order,3\n")).unwrap();

        let bytes = fs::read(&path).unwrap();
        assert_eq!(&bytes[0..3], &[0xEF, 0xBB, 0xBF], "BOM 이 없다");
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains("/shop/order,3"), "본문이 그대로 들어가야 한다");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn 빈_내용은_파일을_만들지_않는다() {
        let dir = temp_dir("empty");
        assert!(save(&dir, input("summary-service", "")).is_err());
        assert!(!dir.join("20260830-141203_summary-service.csv").exists());

        let _ = fs::remove_dir_all(&dir);
    }
}
