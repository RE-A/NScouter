// 과거 XLog 조회 (TRANX_LOAD_TIME_GROUP_V2)
//
// 지금까지 앱은 "현재"만 봤다. 시간 범위 조회는 LoadTimeXLog / ZoomTime /
// 과거 카운터 차트의 **공통 선행 조건**이다.
//
// 파라미터는 실측으로 확정했다 (F-28):
//   date(yyyymmdd) / stime / etime / objHash[] / **pageCount**
// `pageCount` 가 없으면 에러가 아니라 **0건** 이 온다. `startTime`/`endTime` 도 0건이다.

use serde::{Deserialize, Serialize};

use super::pack::MapPack;
use super::value::ScouterValue;

/// 다음 페이지 위치. 응답 MapPack 이 그대로 돌려준다.
///
/// 첫 페이지는 기본값(0,0)으로 요청하고, 이후에는 직전 응답의 값을 그대로 넣는다.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
pub struct PastCursor {
    /// 더 남았는가
    pub has_more: bool,
    pub last_txid: i64,
    pub last_xlog_time: i64,
}

/// 한 페이지 요청 파라미터.
///
/// **`page_count` 를 빼면 조용히 0건이 온다** — 이 프로토콜의 실패 방식이다 (F-15).
///
/// 다음 페이지는 **`stime` 을 `last_xlog_time` 으로 미는** 방식이다 (조회가 시간 오름차순).
/// 실측으로 확인했다:
///
/// | 방식 | 1페이지와 겹침 |
/// |---|---|
/// | `etime = lastXLogTime` | 96/100 |
/// | `stime = lastXLogTime` | **4/100** |
/// | + `lastTxid` 동반 | 4/100 (차이 없음 — 서버가 무시한다) |
///
/// 남은 4건은 경계 시각이 같은 트랜잭션이다. `stime` 을 +1 하면 그 건들을 **잃으므로**
/// 포함으로 두고 호출부가 `dedupe_by_txid` 로 거른다.
pub fn build_past_xlog_param(
    obj_hashes: &[i32],
    date: &str,
    stime: i64,
    etime: i64,
    page_count: i32,
    cursor: &PastCursor,
) -> MapPack {
    let start = if cursor.last_xlog_time != 0 { cursor.last_xlog_time } else { stime };

    let mut param = MapPack::new();
    param.put("date", ScouterValue::Text(date.to_string()));
    param.put("stime", ScouterValue::Decimal(start));
    param.put("etime", ScouterValue::Decimal(etime));
    param.put("pageCount", ScouterValue::Decimal(page_count as i64));
    param.put(
        "objHash",
        ScouterValue::List(
            obj_hashes.iter().map(|h| ScouterValue::Decimal(*h as i64)).collect(),
        ),
    );
    param
}

/// 이미 본 txid 를 걸러낸다.
///
/// 페이지 경계에서 같은 시각의 트랜잭션이 다시 오기 때문이다(위 표 참조).
/// **없는 것보다 중복이 낫다**는 판단으로 `stime` 을 포함으로 두었으므로,
/// 거르는 책임이 여기 있다.
pub fn dedupe_by_txid<T>(seen: &mut std::collections::HashSet<i64>, rows: Vec<T>, txid: impl Fn(&T) -> i64) -> Vec<T> {
    rows.into_iter().filter(|r| seen.insert(txid(r))).collect()
}

/// 응답 메타 MapPack 에서 다음 커서를 뽑는다.
pub fn parse_past_cursor(out: &MapPack) -> PastCursor {
    PastCursor {
        has_more: matches!(out.entries.get("hasMore"), Some(ScouterValue::Boolean(true))),
        last_txid: out.get_decimal("lastTxid").unwrap_or(0),
        last_xlog_time: out.get_decimal("lastXLogTime").unwrap_or(0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASHES: [i32; 2] = [-1585387669, 16367847];

    #[test]
    fn 첫_페이지는_요청한_범위_그대로다() {
        let p = build_past_xlog_param(&HASHES, "20260816", 100, 200, 500, &PastCursor::default());
        assert_eq!(p.get_text("date"), Some("20260816"));
        assert_eq!(p.get_decimal("stime"), Some(100));
        assert_eq!(p.get_decimal("etime"), Some(200));
        assert_eq!(p.get_decimal("pageCount"), Some(500));
    }

    // 다음 페이지는 stime 을 민다. etime 을 당기면 1페이지가 거의 그대로 또 온다(실측 96/100).
    #[test]
    fn 다음_페이지는_stime_을_민다() {
        let cursor = PastCursor { has_more: true, last_txid: -33, last_xlog_time: 1786876830265 };
        let p = build_past_xlog_param(&HASHES, "20260816", 100, 200, 500, &cursor);
        assert_eq!(p.get_decimal("stime"), Some(1786876830265));
        assert_eq!(p.get_decimal("etime"), Some(200), "etime 은 그대로여야 한다");
    }

    // 서버가 lastTxid 를 타이브레이크로 쓰지 않는다(실측). 보내봐야 의미가 없다.
    #[test]
    fn 커서_키는_요청에_넣지_않는다() {
        let cursor = PastCursor { has_more: true, last_txid: -33, last_xlog_time: 1 };
        let p = build_past_xlog_param(&HASHES, "20260816", 0, 200, 500, &cursor);
        assert!(!p.entries.contains_key("lastTxid"));
        assert!(!p.entries.contains_key("lastXLogTime"));
    }

    #[test]
    fn 이미_본_txid_를_거른다() {
        let mut seen = std::collections::HashSet::new();
        let p1 = dedupe_by_txid(&mut seen, vec![1i64, 2, 3], |v| *v);
        assert_eq!(p1, vec![1, 2, 3]);
        // 경계에서 2,3 이 다시 온다
        let p2 = dedupe_by_txid(&mut seen, vec![2i64, 3, 4, 5], |v| *v);
        assert_eq!(p2, vec![4, 5]);
    }

    #[test]
    fn 같은_페이지_안의_중복도_거른다() {
        let mut seen = std::collections::HashSet::new();
        assert_eq!(dedupe_by_txid(&mut seen, vec![7i64, 7, 8], |v| *v), vec![7, 8]);
    }

    // pageCount 가 없으면 에러가 아니라 0건이 온다. 빠뜨리면 원인을 못 찾는다.
    #[test]
    fn pagecount_는_반드시_들어간다() {
        let p = build_past_xlog_param(&HASHES, "20260816", 0, 1, 1, &PastCursor::default());
        assert!(p.entries.contains_key("pageCount"));
    }

    #[test]
    fn objhash_는_리스트로_들어간다() {
        let p = build_past_xlog_param(&HASHES, "20260816", 0, 1, 1, &PastCursor::default());
        match p.entries.get("objHash") {
            Some(ScouterValue::List(v)) => assert_eq!(v.len(), 2),
            other => panic!("objHash 가 리스트가 아니다: {other:?}"),
        }
    }

    #[test]
    fn 커서를_응답에서_읽는다() {
        let mut m = MapPack::new();
        m.put("hasMore", ScouterValue::Boolean(true));
        m.put("lastTxid", ScouterValue::Decimal(-3394315710796195827));
        m.put("lastXLogTime", ScouterValue::Decimal(1786876830265));

        let c = parse_past_cursor(&m);
        assert!(c.has_more);
        assert_eq!(c.last_txid, -3394315710796195827);
        assert_eq!(c.last_xlog_time, 1786876830265);
    }

    // 마지막 페이지는 hasMore=false 다. true 로 잘못 읽으면 무한 루프가 된다.
    #[test]
    fn hasmore_가_false_면_끝이다() {
        let mut m = MapPack::new();
        m.put("hasMore", ScouterValue::Boolean(false));
        assert!(!parse_past_cursor(&m).has_more);
        // 키가 아예 없어도 끝으로 본다 — 도는 것보다 멈추는 게 낫다.
        assert!(!parse_past_cursor(&MapPack::new()).has_more);
    }
}
