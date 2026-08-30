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
            }
        })
        .collect()
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
}
