// 요약(Summary) 조회
//
// ASIS SummaryDialog 가 쓰는 커맨드 묶음이다. 콜렉터 바이트코드(`SummaryService`)와
// 실측으로 확인한 사실 (F-38):
//
// | 커맨드 | 응답 리스트 |
// |---|---|
// | `LOAD_SERVICE_SUMMARY`       | id · count · error · elapsed · **cpu · mem** |
// | `LOAD_SQL_SUMMARY`           | id · count · error · elapsed |
// | `LOAD_APICALL_SUMMARY`       | id · count · error · elapsed |
// | `LOAD_IP_SUMMARY`            | id · count |
// | `LOAD_UA_SUMMARY`            | id · count |
// | `LOAD_SERVICE_ERROR_SUMMARY` | id · error · service · message · count · txid · sql · apicall · fullstack |
//
// 파라미터는 여섯 개 모두 같다 — `date` · `stime` · `etime` · `objType` · `objHash`.
// `cpu`/`mem` 은 서버가 `SummaryEnum.APP(1)` 일 때만 리스트를 만든다.
//
// **`id` 는 해시다.** 사전(GET_TEXT_100)으로 풀지 않으면 화면에 숫자만 남는다.

use serde::Serialize;

use super::pack::MapPack;
use super::value::ScouterValue;

/// 요약 한 줄. 없는 항목은 None 이다 — **0 으로 채우면 안 된다.**
/// IP 요약에 `elapsed=0` 을 넣으면 "0ms 걸렸다"로 읽힌다.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SummaryRow {
    /// 해시. 종류에 따라 service / sql / apicall / ip / ua 사전으로 푼다
    pub id: i32,
    pub count: i64,
    pub error: Option<i64>,
    /// 소요 시간 합(ms). 나눗셈은 화면에서 한다
    pub elapsed: Option<i64>,
    pub cpu: Option<i64>,
    pub mem: Option<i64>,
}

/// 요약 요청. 여섯 커맨드가 모두 같은 파라미터를 쓴다.
///
/// `obj_hash` 가 0 이면 **타입 전체**다 (SummaryDialog 가 여는 화면).
pub fn build_summary_param(date: &str, stime: i64, etime: i64, obj_type: &str, obj_hash: i32) -> MapPack {
    let mut param = MapPack::new();
    param.put("date", ScouterValue::Text(date.to_string()));
    param.put("stime", ScouterValue::Decimal(stime));
    param.put("etime", ScouterValue::Decimal(etime));
    param.put("objType", ScouterValue::Text(obj_type.to_string()));
    param.put("objHash", ScouterValue::Decimal(obj_hash as i64));
    param
}

fn list_of<'a>(map: &'a MapPack, key: &str) -> Option<&'a [ScouterValue]> {
    match map.entries.get(key) {
        Some(ScouterValue::List(items)) => Some(items),
        _ => None,
    }
}

fn at(list: Option<&[ScouterValue]>, i: usize) -> Option<i64> {
    list?.get(i)?.as_decimal()
}

/// 병렬 리스트를 행으로 묶는다.
///
/// **`id` 의 길이가 기준이다.** 다른 리스트가 짧으면 그 칸만 None 이 된다 —
/// 길이를 맞추려고 행을 버리면 있는 트래픽이 화면에서 사라진다.
pub fn parse_summary(map: &MapPack) -> Vec<SummaryRow> {
    let ids = match list_of(map, "id") {
        Some(v) => v,
        None => return Vec::new(),
    };
    let count = list_of(map, "count");
    let error = list_of(map, "error");
    let elapsed = list_of(map, "elapsed");
    let cpu = list_of(map, "cpu");
    let mem = list_of(map, "mem");

    ids.iter()
        .enumerate()
        .filter_map(|(i, id)| {
            Some(SummaryRow {
                id: id.as_decimal()? as i32,
                count: at(count, i).unwrap_or(0),
                error: at(error, i),
                elapsed: at(elapsed, i),
                cpu: at(cpu, i),
                mem: at(mem, i),
            })
        })
        .collect()
}

/// 에러 요약 한 줄. 다른 요약과 리스트 구성이 아예 다르다.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ErrorSummaryRow {
    pub id: i32,
    pub error: i32,
    pub service: i32,
    pub message: i32,
    pub count: i64,
    /// 대표 트랜잭션. i64 라 **문자열로 넘긴다** (자바스크립트 정밀도)
    #[serde(serialize_with = "super::profile::serialize_i64_as_string")]
    pub txid: i64,
    pub sql: i32,
    pub apicall: i32,
}

pub fn parse_error_summary(map: &MapPack) -> Vec<ErrorSummaryRow> {
    let ids = match list_of(map, "id") {
        Some(v) => v,
        None => return Vec::new(),
    };
    let error = list_of(map, "error");
    let service = list_of(map, "service");
    let message = list_of(map, "message");
    let count = list_of(map, "count");
    let txid = list_of(map, "txid");
    let sql = list_of(map, "sql");
    let apicall = list_of(map, "apicall");

    ids.iter()
        .enumerate()
        .filter_map(|(i, id)| {
            Some(ErrorSummaryRow {
                id: id.as_decimal()? as i32,
                error: at(error, i).unwrap_or(0) as i32,
                service: at(service, i).unwrap_or(0) as i32,
                message: at(message, i).unwrap_or(0) as i32,
                count: at(count, i).unwrap_or(0),
                txid: at(txid, i).unwrap_or(0),
                sql: at(sql, i).unwrap_or(0) as i32,
                apicall: at(apicall, i).unwrap_or(0) as i32,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dec_list(v: &[i64]) -> ScouterValue {
        ScouterValue::List(v.iter().map(|n| ScouterValue::Decimal(*n)).collect())
    }

    #[test]
    fn 요청은_여섯_커맨드가_같은_파라미터를_쓴다() {
        let p = build_summary_param("20260819", 1000, 2000, "tomcat", 0);
        assert_eq!(p.get_text("date"), Some("20260819"));
        assert_eq!(p.get_decimal("stime"), Some(1000));
        assert_eq!(p.get_decimal("etime"), Some(2000));
        assert_eq!(p.get_text("objType"), Some("tomcat"));
        assert_eq!(p.get_decimal("objHash"), Some(0), "0 이면 타입 전체다");
    }

    #[test]
    fn 서비스_요약은_cpu_와_mem_까지_읽는다() {
        let mut m = MapPack::new();
        m.put("id", dec_list(&[10, 20]));
        m.put("count", dec_list(&[5, 7]));
        m.put("error", dec_list(&[0, 1]));
        m.put("elapsed", dec_list(&[500, 700]));
        m.put("cpu", dec_list(&[11, 22]));
        m.put("mem", dec_list(&[33, 44]));

        let rows = parse_summary(&m);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1].id, 20);
        assert_eq!(rows[1].count, 7);
        assert_eq!(rows[1].error, Some(1));
        assert_eq!(rows[1].elapsed, Some(700));
        assert_eq!(rows[1].cpu, Some(22));
        assert_eq!(rows[1].mem, Some(44));
    }

    #[test]
    fn 없는_항목은_0_이_아니라_none_이다() {
        // IP·UA 요약은 id 와 count 만 온다. elapsed 를 0 으로 채우면
        // "0ms 걸렸다" 로 읽혀 없는 사실이 생긴다.
        let mut m = MapPack::new();
        m.put("id", dec_list(&[7]));
        m.put("count", dec_list(&[3]));

        let rows = parse_summary(&m);
        assert_eq!(rows[0].count, 3);
        assert_eq!(rows[0].elapsed, None);
        assert_eq!(rows[0].error, None);
        assert_eq!(rows[0].cpu, None);
    }

    #[test]
    fn 짧은_리스트는_그_칸만_비운다() {
        // 행을 버리면 실제로 있던 트래픽이 화면에서 사라진다.
        let mut m = MapPack::new();
        m.put("id", dec_list(&[1, 2, 3]));
        m.put("count", dec_list(&[10, 20]));

        let rows = parse_summary(&m);
        assert_eq!(rows.len(), 3, "id 길이가 기준이다");
        assert_eq!(rows[2].count, 0);
    }

    #[test]
    fn id_가_없으면_빈_표다() {
        assert!(parse_summary(&MapPack::new()).is_empty());
        assert!(parse_error_summary(&MapPack::new()).is_empty());
    }

    #[test]
    fn 에러_요약은_대표_txid_를_들고_온다() {
        let mut m = MapPack::new();
        m.put("id", dec_list(&[-896835060]));
        m.put("error", dec_list(&[-1513187753]));
        m.put("service", dec_list(&[-896835060]));
        m.put("message", dec_list(&[-1187029540]));
        m.put("count", dec_list(&[1246]));
        m.put("txid", dec_list(&[-4159901529493293911]));
        m.put("sql", dec_list(&[0]));
        m.put("apicall", dec_list(&[-1284677727]));

        let rows = parse_error_summary(&m);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].count, 1246);
        assert_eq!(rows[0].txid, -4159901529493293911, "i64 정밀도가 살아 있어야 한다");
        assert_eq!(rows[0].sql, 0, "SQL 이 원인이 아닌 에러는 0 이다");
    }
}
