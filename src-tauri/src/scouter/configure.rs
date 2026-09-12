// 설정 조회 (에이전트 / 콜렉터)
//
// 콜렉터 바이트코드(`ConfigureService`)에서 읽은 사실:
//
// | 커맨드 | 파라미터 | 응답 |
// |---|---|---|
// | `GET_CONFIGURE_SERVER`  | 없음 | `serverConfig`(Text 전문) · `configKey`(List) |
// | `LIST_CONFIGURE_SERVER` | 없음 | `key` · `value` · `default` 세 List |
// | `GET_CONFIGURE_WAS`     | `objHash` | `agentConfig`(Text 전문) · `configKey`(List) |
// | `LIST_CONFIGURE_WAS`    | `objHash` | `key` · `value` · `default` 세 List |
//
// WAS 쪽 둘은 콜렉터가 **에이전트에 다시 물어본다**. 에이전트가 없거나 답이 null 이면
// 콜렉터는 아무것도 쓰지 않는다 — 빈 응답이 오류 메시지 대신 온다.

use std::collections::HashMap;

use serde::Serialize;

use super::pack::MapPack;
use super::value::ScouterValue;

/// 설정 항목 하나.
///
/// 이 화면을 여는 이유는 "무엇이 기본값과 다른가"다. 300개를 나열하면 그걸 못 찾으므로
/// `changed` 를 파싱 단계에서 정해 둔다.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ConfigEntry {
    pub key: String,
    pub value: String,
    pub default: String,
    pub changed: bool,
    /// 이 항목이 무엇을 하는가.
    ///
    /// **에이전트 자신이 준다** (`@ConfigDesc`, `CONFIGURE_DESC`). 우리가 따로 적으면
    /// 에이전트 판이 올라갈 때마다 어긋난다 — 에이전트 코드에 붙은 설명이라 그 판과
    /// 늘 맞는다. 에이전트가 설명을 안 주면(오래된 판) 빈 문자열이다.
    pub desc: String,
    /// 값 종류 (`CONFIGURE_VALUE_TYPE`). 0 은 «모른다» — 그때 화면은 글자 칸을 준다.
    pub value_type: u8,
}

/// 값 종류. ASIS `scouter.lang.conf.ValueType` 과 번호가 같아야 한다
pub mod value_type {
    /// 모른다 — 에이전트가 안 줬다
    pub const UNKNOWN: u8 = 0;
    pub const VALUE: u8 = 1;
    pub const NUM: u8 = 2;
    pub const BOOL: u8 = 3;
    pub const COMMA_SEPARATED: u8 = 4;
    pub const COMMA_COLON_SEPARATED: u8 = 5;
}

/// 설정 전문 + 항목 표.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct ConfigView {
    /// 설정 파일 원문. 없으면 빈 문자열
    pub text: String,
    pub entries: Vec<ConfigEntry>,
}

// WAS 쪽 요청 파라미터는 `objHash` 하나뿐이라 `object::build_object_param` 을 그대로 쓴다.
// 콜렉터 쪽 둘은 파라미터가 없다.

/// 설정 파일 원문을 꺼낸다.
///
/// 에이전트는 `agentConfig`, 콜렉터는 `serverConfig` 로 같은 것을 보낸다.
/// 부르는 쪽이 어느 쪽인지 알 필요가 없게 여기서 둘 다 본다.
pub fn parse_config_text(map: &MapPack) -> String {
    for key in ["agentConfig", "serverConfig"] {
        if let Some(ScouterValue::Text(s)) = map.entries.get(key) {
            return s.clone();
        }
    }
    String::new()
}

/// 값 하나를 표에 쓸 문자열로.
///
/// **Null 을 "null" 로 쓰면 안 된다.** 실제 설정값이 비어 있다는 뜻이라
/// 그렇게 쓰면 `net_local_udp_ip=null` 이라는 없는 설정이 보인다.
fn text_of(v: &ScouterValue) -> String {
    v.to_display()
}

/// 저장 전에 역슬래시를 두 번으로 늘린다.
///
/// 에이전트는 받은 텍스트를 `Configure.saveText()` 로 파일에 쓰고 다시 읽는데,
/// 그 읽기가 자바 프로퍼티 규칙이라 **역슬래시를 이스케이프 시작으로 본다**.
/// 그대로 보내면 윈도우 경로가 저장 후 구분자를 잃는다.
/// ASIS `ConfigureView.saveConfigurations()` 도 같은 처리를 한다.
pub fn escape_config_text(text: &str) -> String {
    text.replace('\\', "\\\\")
}

/// 저장 응답 해석.
///
/// 콜렉터는 성공/실패를 예외가 아니라 `result` 텍스트로 준다.
/// **"응답이 왔다"를 성공으로 읽으면 안 된다** — 실패해도 MapPack 은 온다.
// `Some("")` 로 줄일 수 있으나 위아래 `Some(r) if …` 와 모양이 갈라진다.
#[allow(clippy::redundant_guards)]
pub fn parse_save_result(map: &MapPack) -> Result<(), String> {
    match map.get_text("result") {
        Some(r) if r.eq_ignore_ascii_case("true") => Ok(()),
        Some(r) if r.is_empty() => Err("콜렉터가 결과를 비워 보냈습니다".to_string()),
        Some(r) => Err(r.to_string()),
        None => Err("콜렉터 응답에 result 가 없습니다".to_string()),
    }
}

fn list_of<'a>(map: &'a MapPack, key: &str) -> &'a [ScouterValue] {
    match map.entries.get(key) {
        Some(ScouterValue::List(items)) => items,
        _ => &[],
    }
}

/// key / value / default 세 List 를 항목으로 묶는다.
///
/// **세 목록의 길이가 어긋나면 짧은 쪽에 맞춰 자른다.** 길이를 믿고 인덱스로 짝지으면
/// 없는 자리가 빈 값이 되어 "기본값이 비었다 → 바뀐 설정"이라는 거짓 표시가 생긴다.
pub fn parse_config_entries(map: &MapPack) -> Vec<ConfigEntry> {
    let keys = list_of(map, "key");
    let values = list_of(map, "value");
    let defaults = list_of(map, "default");

    let n = keys.len().min(values.len()).min(defaults.len());
    (0..n)
        .map(|i| {
            let value = text_of(&values[i]);
            let default = text_of(&defaults[i]);
            ConfigEntry {
                key: text_of(&keys[i]),
                changed: value != default,
                value,
                default,
                desc: String::new(),
                value_type: value_type::UNKNOWN,
            }
        })
        .collect()
}

/// 설명 응답. 키마다 Text 하나다.
///
/// **Text 가 아닌 값은 버린다** — 판에 따라 값이 비어(Null) 오기도 하는데,
/// 그걸 "null" 로 적으면 없는 설명이 생긴다.
pub fn parse_config_desc(map: &MapPack) -> HashMap<String, String> {
    map.entries
        .iter()
        .filter_map(|(k, v)| match v {
            ScouterValue::Text(s) if !s.trim().is_empty() => Some((k.clone(), s.clone())),
            _ => None,
        })
        .collect()
}

/// 값 종류 응답. 키마다 Decimal 하나다. 모르는 번호는 «모른다» 로 둔다.
pub fn parse_config_value_types(map: &MapPack) -> HashMap<String, u8> {
    map.entries
        .iter()
        .filter_map(|(k, v)| {
            let n = v.as_decimal()?;
            let t = u8::try_from(n).ok().filter(|t| (1..=5).contains(t))?;
            Some((k.clone(), t))
        })
        .collect()
}

/// `$` 로 감싼 자리를 지운다 — ASIS `ConfigureView.removeVariableString`.
///
/// 몇몇 설정은 키 이름 안에 자리 표시가 있다(`$name$` 같은 것). 설명과 값 종류는
/// **자리를 뺀 이름**으로 걸려 있기도 해서, 그대로 찾으면 못 찾는다.
pub fn strip_variable(key: &str) -> String {
    let mut out = String::with_capacity(key.len());
    let mut sink = false;
    for c in key.chars() {
        if c == '$' {
            sink = !sink;
        } else if !sink {
            out.push(c);
        }
    }
    out
}

/// 항목에 설명과 값 종류를 붙인다.
///
/// 키로 먼저 찾고, 없으면 자리 표시를 뺀 이름으로 찾는다 (ASIS 와 같은 순서).
pub fn attach_meta(
    entries: &mut [ConfigEntry],
    desc: &HashMap<String, String>,
    types: &HashMap<String, u8>,
) {
    for e in entries.iter_mut() {
        let bare = strip_variable(&e.key);
        if let Some(d) = desc.get(&e.key).or_else(|| desc.get(&bare)) {
            e.desc = d.clone();
        }
        if let Some(t) = types.get(&e.key).or_else(|| types.get(&bare)) {
            e.value_type = *t;
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn 역슬래시를_두_번으로_늘린다() {
        // 안 늘리면 저장 후 경로 구분자가 사라진다 (자바 프로퍼티 이스케이프).
        let src = concat!("log_dir=c:", "\\", "logs", "\\", "app");
        let out = escape_config_text(src);
        assert_eq!(out.matches('\\').count(), 4, "out={out}");
    }

    #[test]
    fn 역슬래시가_없으면_그대로다() {
        let src = "counter_interaction_enabled=true";
        assert_eq!(escape_config_text(src), src);
    }

    #[test]
    fn 저장_결과는_result_로_판단한다() {
        // **응답이 왔다를 성공으로 읽으면 안 된다** — 실패해도 MapPack 은 온다.
        let mut ok = MapPack::new();
        ok.put("result", ScouterValue::Text("true".into()));
        assert!(parse_save_result(&ok).is_ok());

        let mut bad = MapPack::new();
        bad.put("result", ScouterValue::Text("java.io.IOException: 권한 없음".into()));
        assert_eq!(parse_save_result(&bad).unwrap_err(), "java.io.IOException: 권한 없음");
    }

    #[test]
    fn result_가_없으면_성공이_아니다() {
        // 조용히 성공으로 넘기면 저장되지 않은 설정을 저장됐다고 말하게 된다.
        assert!(parse_save_result(&MapPack::new()).is_err());
    }

    use super::*;

    fn text_list(items: &[&str]) -> ScouterValue {
        ScouterValue::List(items.iter().map(|s| ScouterValue::Text(s.to_string())).collect())
    }

    #[test]
    fn 에이전트와_콜렉터_전문을_같은_함수로_읽는다() {
        let mut agent = MapPack::new();
        agent.put("agentConfig", ScouterValue::Text("net_collector_ip=127.0.0.1".into()));
        assert_eq!(parse_config_text(&agent), "net_collector_ip=127.0.0.1");

        let mut server = MapPack::new();
        server.put("serverConfig", ScouterValue::Text("server_id=NSCOUTER".into()));
        assert_eq!(parse_config_text(&server), "server_id=NSCOUTER");

        assert_eq!(parse_config_text(&MapPack::new()), "");
    }

    #[test]
    fn 기본값과_다른_항목만_changed_로_표시된다() {
        let mut map = MapPack::new();
        map.put("key", text_list(&["net_collector_ip", "net_collector_tcp_port"]));
        map.put(
            "value",
            ScouterValue::List(vec![
                ScouterValue::Text("scouter-collector".into()),
                ScouterValue::Decimal(6100),
            ]),
        );
        map.put(
            "default",
            ScouterValue::List(vec![
                ScouterValue::Text("127.0.0.1".into()),
                ScouterValue::Decimal(6100),
            ]),
        );

        let rows = parse_config_entries(&map);
        assert_eq!(rows.len(), 2);
        assert!(rows[0].changed, "값이 기본값과 다르면 changed 여야 한다");
        assert_eq!(rows[0].value, "scouter-collector");
        assert_eq!(rows[0].default, "127.0.0.1");
        assert!(!rows[1].changed, "같은 값을 바뀌었다고 하면 안 된다");
        assert_eq!(rows[1].value, "6100", "Decimal 도 표에서는 문자열이다");
    }

    #[test]
    fn null_값은_빈_문자열이지_null_이_아니다() {
        let mut map = MapPack::new();
        map.put("key", text_list(&["net_local_udp_ip"]));
        map.put("value", ScouterValue::List(vec![ScouterValue::Null]));
        map.put("default", ScouterValue::List(vec![ScouterValue::Null]));

        let rows = parse_config_entries(&map);
        assert_eq!(rows[0].value, "");
        assert!(!rows[0].changed, "둘 다 비었으면 바뀐 게 아니다");
    }

    #[test]
    fn 길이가_어긋나면_짧은_쪽에_맞춘다() {
        let mut map = MapPack::new();
        map.put("key", text_list(&["a", "b", "c"]));
        map.put("value", text_list(&["1", "2"]));
        map.put("default", text_list(&["1"]));

        let rows = parse_config_entries(&map);
        assert_eq!(rows.len(), 1, "가장 짧은 default 에 맞춰야 한다");
        assert_eq!(rows[0].key, "a");
    }

    #[test]
    fn 목록이_없으면_빈_표다() {
        assert!(parse_config_entries(&MapPack::new()).is_empty());
    }

    fn entry(key: &str) -> ConfigEntry {
        ConfigEntry {
            key: key.into(),
            value: String::new(),
            default: String::new(),
            changed: false,
            desc: String::new(),
            value_type: value_type::UNKNOWN,
        }
    }

    #[test]
    fn 설명은_키마다_text_하나다() {
        let mut m = MapPack::new();
        m.put("profile_sql_param_enabled", ScouterValue::Text("SQL 파라미터를 남긴다".into()));
        let d = parse_config_desc(&m);
        assert_eq!(d.get("profile_sql_param_enabled").map(String::as_str), Some("SQL 파라미터를 남긴다"));
    }

    #[test]
    fn 비어_온_설명은_버린다() {
        // "null" 로 적으면 없는 설명이 생긴다.
        let mut m = MapPack::new();
        m.put("a", ScouterValue::Null);
        m.put("b", ScouterValue::Text("  ".into()));
        assert!(parse_config_desc(&m).is_empty());
    }

    #[test]
    fn 값_종류는_1에서_5_까지만_받는다() {
        // 모르는 번호를 그대로 넘기면 화면이 없는 입력기를 찾는다.
        let mut m = MapPack::new();
        m.put("a", ScouterValue::Decimal(3));
        m.put("b", ScouterValue::Decimal(9));
        m.put("c", ScouterValue::Text("3".into()));
        let t = parse_config_value_types(&m);
        assert_eq!(t.get("a"), Some(&value_type::BOOL));
        assert!(!t.contains_key("b"));
        assert!(!t.contains_key("c"));
    }

    #[test]
    fn 자리_표시를_뺀_이름을_만든다() {
        // ASIS removeVariableString 과 같은 규칙.
        assert_eq!(strip_variable("plugin_$name$_enabled"), "plugin__enabled");
        assert_eq!(strip_variable("plain_key"), "plain_key");
    }

    #[test]
    fn 설명과_종류를_항목에_붙인다() {
        let mut es = vec![entry("trace_http_client_ip_header_key"), entry("x_$v$_y")];
        let desc = HashMap::from([
            ("trace_http_client_ip_header_key".to_string(), "IP 헤더".to_string()),
            // 자리 표시를 뺀 이름으로만 걸려 있는 경우
            ("x__y".to_string(), "변수 키".to_string()),
        ]);
        let types = HashMap::from([("x__y".to_string(), value_type::NUM)]);
        attach_meta(&mut es, &desc, &types);
        assert_eq!(es[0].desc, "IP 헤더");
        assert_eq!(es[0].value_type, value_type::UNKNOWN, "종류를 안 줬으면 모른다로 둔다");
        assert_eq!(es[1].desc, "변수 키");
        assert_eq!(es[1].value_type, value_type::NUM);
    }
}
