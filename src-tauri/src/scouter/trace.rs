// 분산 트랜잭션 조회 (XLOG_READ_BY_GXID)
//
// 하나의 요청이 여러 애플리케이션을 거치면 XLog 가 여러 건으로 쪼개진다.
// 그 조각들을 다시 하나로 묶는 열쇠가 `gxid` 다.
//
// **커맨드마다 읽는 키가 다르다** (콜렉터 2.21.3 XLogService 바이트코드 실측):
//
// | 커맨드 | 읽는 키 |
// |---|---|
// | `XLOG_READ_BY_GXID` | `date`(text), `gxid`(long) |
// | `XLOG_LOAD_BY_GXID` | `stime`, `etime`, `gxid` — 날짜를 stime/etime 에서 **유도**한다 |
//
// LOAD 쪽에 `date` 를 주면 `stime=0` → `19700101` 을 뒤져 **조용히 0건**이 온다 (F-15).
// 우리는 날짜를 이미 알고 있으므로 READ 를 쓴다.

use super::pack::MapPack;
use super::value::ScouterValue;

/// gxid 로 연관 XLog 전부를 요청한다.
pub fn build_gxid_param(date: &str, gxid: i64) -> MapPack {
    let mut param = MapPack::new();
    param.put("date", ScouterValue::Text(date.to_string()));
    param.put("gxid", ScouterValue::Decimal(gxid));
    param
}

/// caller 를 거슬러 올라갈 때 쓰는 단건 요청.
///
/// `gxid` 가 0 인 오래된 에이전트의 트랜잭션은 gxid 로 묶을 수 없어
/// `caller` 를 한 단계씩 따라가야 한다 (ASIS XLogCallView.LoadChainXLog).
pub fn build_txid_param(date: &str, txid: i64) -> MapPack {
    let mut param = MapPack::new();
    param.put("date", ScouterValue::Text(date.to_string()));
    param.put("txid", ScouterValue::Decimal(txid));
    param
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gxid_param_uses_date_not_time_range() {
        let p = build_gxid_param("20260817", -8539914586336317490);

        // READ 는 date 를 텍스트로 읽는다. stime/etime 을 넣는 건 LOAD 의 계약이다.
        assert_eq!(p.get_text("date"), Some("20260817"));
        assert!(p.entries.get("stime").is_none(), "READ 에 stime 을 넣으면 안 된다");

        // i64 전 범위를 쓰므로 음수가 그대로 살아야 한다.
        assert_eq!(p.get_decimal("gxid"), Some(-8539914586336317490));
    }

    #[test]
    fn txid_param_carries_date_and_txid() {
        let p = build_txid_param("20260817", 4516550232655921395);
        assert_eq!(p.get_text("date"), Some("20260817"));
        assert_eq!(p.get_decimal("txid"), Some(4516550232655921395));
    }
}
