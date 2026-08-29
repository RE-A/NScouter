// 넓은 구간에서 조건으로 XLog 찾기 (SEARCH_XLOG_LIST)
//
// 지금까지 과거 조회는 구간의 XLog 를 **다 받아** 화면에서 걸렀다.
// 좁은 구간(1,600건 남짓)이면 그 편이 낫다 — 잘림이 없고 오브젝트를 여럿 다룬다.
// 넓은 구간에서 몇 건을 찾을 때는 서버가 걸러 주는 쪽이 훨씬 싸다 (F-54):
//
//   창  2분: 다 받기 167ms  ·  서버가 거르기  45ms
//   창 30분: 다 받기 1116ms ·  서버가 거르기 144ms
//
// **대신 세 가지를 알고 써야 한다.**
//
// 1. **상한에서 조용히 멈춘다.** 서버 설정 `req_search_xlog_max_count`(기본 500)에
//    닿으면 그냥 끊긴다. 응답에 `hasMore` 도 메타 팩도 없다 — «500이 전부» 와
//    «500에서 잘림» 이 구별되지 않는다. 그래서 상한을 **서버에서 읽어 와** 건수와
//    맞대 보고, 같으면 화면에 «잘렸을 수 있다» 고 말한다.
// 2. **오브젝트는 하나뿐이다.** `objHash` 가 리스트가 아니라 `int` 다.
//    0 이면 안 가린다(전부).
// 3. **필터는 `StrMatch` 글롭이다.** `*` 가 없으면 완전 일치다.
//    화면 필터(포함)와 뜻이 다르므로 `to_glob` 이 감싸 준다.

use serde::{Deserialize, Serialize};

use super::pack::MapPack;
use super::value::ScouterValue;

/// 서버가 상한을 안 알려줄 때 쓰는 값. `req_search_xlog_max_count` 의 기본값이다.
///
/// **추측이라는 걸 화면에 알려야 한다** — 서버가 이 값을 바꿔 두었을 수 있다.
pub const DEFAULT_SEARCH_MAX: i32 = 500;

/// 서버 설정에서 상한을 읽을 때 찾는 키
pub const SEARCH_MAX_KEY: &str = "req_search_xlog_max_count";

/// 찾을 조건. 비어 있는 항목은 요청에 넣지 않는다(= 안 가린다).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchXLogFilter {
    pub stime: i64,
    pub etime: i64,
    /// 0 이면 오브젝트를 안 가린다. **리스트가 아니다** — 서버가 하나만 받는다.
    #[serde(default)]
    pub obj_hash: i32,
    #[serde(default)]
    pub service: String,
    #[serde(default)]
    pub ip: String,
    #[serde(default)]
    pub login: String,
    #[serde(default)]
    pub desc: String,
    /// 앱이 심는 자유 필드 5개. 쓰는 앱에서만 값이 있다.
    #[serde(default)]
    pub text1: String,
    #[serde(default)]
    pub text2: String,
    #[serde(default)]
    pub text3: String,
    #[serde(default)]
    pub text4: String,
    #[serde(default)]
    pub text5: String,
}

/// 사람이 친 말을 `StrMatch` 글롭으로 바꾼다.
///
/// **`*` 가 없으면 서버는 완전 일치로 본다.** 화면의 다른 필터가 전부 «포함» 이라
/// 여기만 완전 일치면 `/order/orders` 를 쳤을 때 `/order/orders/{id}<GET>` 이
/// 안 나오고, 그게 «없다» 로 읽힌다 — 조용히 틀린 답이다.
///
/// 그래서 **`*` 를 직접 쓴 사람은 그 뜻대로**, 안 쓴 사람은 포함으로 감싼다.
pub fn to_glob(raw: &str) -> String {
    let t = raw.trim();
    if t.is_empty() || t.contains('*') {
        return t.to_string();
    }
    format!("*{t}*")
}

/// 서버 설정 본문에서 `req_search_xlog_max_count` 를 뽑는다.
///
/// 못 찾으면 `None` — 부르는 쪽이 기본값을 쓰되 «추측» 이라고 표시한다.
/// 주석 처리된 줄(`#`)은 값이 아니다.
pub fn parse_search_max(config_text: &str) -> Option<i32> {
    for line in config_text.lines() {
        let line = line.trim();
        if line.starts_with('#') {
            continue;
        }
        let Some((k, v)) = line.split_once('=') else { continue };
        if k.trim() != SEARCH_MAX_KEY {
            continue;
        }
        if let Ok(n) = v.trim().parse::<i32>() {
            if n > 0 {
                return Some(n);
            }
        }
    }
    None
}

/// 요청 파라미터.
///
/// 빈 항목을 **넣지 않는 것이 중요하다.** 빈 문자열을 넣으면 서버가 그걸로
/// `StrMatch` 를 만들어 아무것도 안 맞는다.
pub fn build_search_xlog_param(f: &SearchXLogFilter) -> MapPack {
    let mut p = MapPack::new();
    p.put("stime", ScouterValue::Decimal(f.stime));
    p.put("etime", ScouterValue::Decimal(f.etime));
    if f.obj_hash != 0 {
        p.put("objHash", ScouterValue::Decimal(f.obj_hash as i64));
    }
    for (key, raw) in [
        ("service", &f.service),
        ("ip", &f.ip),
        ("login", &f.login),
        ("desc", &f.desc),
        ("text1", &f.text1),
        ("text2", &f.text2),
        ("text3", &f.text3),
        ("text4", &f.text4),
        ("text5", &f.text5),
    ] {
        let g = to_glob(raw);
        if !g.is_empty() {
            p.put(key, ScouterValue::Text(g));
        }
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 빈_조건은_요청에_넣지_않는다() {
        // 빈 문자열을 넣으면 서버가 그걸로 StrMatch 를 만들어 **아무것도 안 맞는다.**
        let p = build_search_xlog_param(&SearchXLogFilter {
            stime: 10,
            etime: 20,
            ..Default::default()
        });
        assert_eq!(p.get_decimal("stime"), Some(10));
        assert_eq!(p.get_decimal("etime"), Some(20));
        assert!(!p.entries.contains_key("service"));
        assert!(!p.entries.contains_key("ip"));
        assert!(!p.entries.contains_key("objHash"), "0 은 «안 가린다» 라 보내지 않는다");
    }

    #[test]
    fn 오브젝트는_하나만_보낸다() {
        let p = build_search_xlog_param(&SearchXLogFilter {
            obj_hash: -1585387669,
            ..Default::default()
        });
        // 리스트가 아니다 — 서버가 getInt 로 읽는다
        assert_eq!(p.get_decimal("objHash"), Some(-1585387669));
    }

    #[test]
    fn 별표가_없으면_포함으로_감싼다() {
        // 서버는 * 가 없으면 완전 일치로 본다. 화면의 다른 필터는 전부 «포함» 이다.
        let p = build_search_xlog_param(&SearchXLogFilter {
            service: "/order/orders".into(),
            ..Default::default()
        });
        assert_eq!(p.get_text("service"), Some("*/order/orders*"));
    }

    #[test]
    fn 별표를_직접_쓰면_그대로_둔다() {
        assert_eq!(to_glob("*/order/*"), "*/order/*");
        assert_eq!(to_glob("/order/orders"), "*/order/orders*");
        // 앞뒤 공백은 사람이 흘린 것이다. 그대로 보내면 아무것도 안 맞는다.
        assert_eq!(to_glob("  /order  "), "*/order*");
        assert_eq!(to_glob("   "), "");
    }

    #[test]
    fn 서버_설정에서_상한을_읽는다() {
        let text = "\
# 검색 상한
net_tcp_service_pool_size=100
req_search_xlog_max_count=1200
xlog_queue_size=3000
";
        assert_eq!(parse_search_max(text), Some(1200));
    }

    #[test]
    fn 주석은_값이_아니다() {
        // 주석에 적힌 기본값을 진짜 설정으로 읽으면 상한을 틀리게 안다
        let text = "#req_search_xlog_max_count=500\nxlog_queue_size=3000\n";
        assert_eq!(parse_search_max(text), None);
    }

    #[test]
    fn 항목이_없으면_모른다() {
        assert_eq!(parse_search_max("xlog_queue_size=3000\n"), None);
        // 0 이나 음수는 상한으로 쓸 수 없다
        assert_eq!(parse_search_max("req_search_xlog_max_count=0\n"), None);
    }
}
