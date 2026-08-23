// 실시간 성능 카운터 요청/응답 처리
//
// 근거: docs/verified-facts.md F-15 (실서버 실측)
//       ASIS CounterRealTimeAllView.java:287-300

use serde::Serialize;

use super::pack::MapPack;
use super::value::ScouterValue;

/// 카운터 1개에 대한 한 시점의 전 오브젝트 값.
///
/// Collector 응답이 카운터 단위이므로 이벤트도 카운터 단위로 내보낸다.
#[derive(Debug, Clone, Serialize)]
pub struct CounterUpdate {
    /// 수집 시각 (epoch ms). 응답에 시각이 없어 클라이언트 수신 시각을 쓴다.
    pub time: i64,
    /// counters.xml 표기 그대로의 카운터명 (`TPS`, `Cpu` …)
    pub counter: String,
    pub values: Vec<CounterValue>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CounterValue {
    pub obj_hash: i32,
    pub value: f64,
    /// 쌍으로 오는 카운터의 총량(상한). 없으면 스칼라 카운터다 (F-33)
    pub total: Option<f64>,
}

/// COUNTER_REAL_TIME_ALL 요청 파라미터.
///
/// 카운터 1개당 요청 1회다. `objHash` 리스트를 보내면 **에러 없이 0건**이 온다 (F-15).
/// `counter` 는 counters.xml 표기 그대로여야 한다 (`TPS`, `Cpu`, `HeapUsed` …).
pub fn build_counter_param(obj_type: &str, counter: &str) -> MapPack {
    let mut param = MapPack::new();
    param.put("objType", ScouterValue::Text(obj_type.to_string()));
    param.put("counter", ScouterValue::Text(counter.to_string()));
    param
}

/// 응답 MapPack 에서 (objHash, value) 쌍을 뽑는다.
///
/// 응답은 `objHash` 와 `value` 가 **같은 순서의 병렬 리스트**로 온다.
/// 길이가 다르면 짧은 쪽에 맞춘다.
pub fn parse_counter_values(out: &MapPack) -> Vec<(i32, f64)> {
    let (Some(ScouterValue::List(hashes)), Some(ScouterValue::List(values))) =
        (out.entries.get("objHash"), out.entries.get("value"))
    else {
        return Vec::new();
    };

    hashes
        .iter()
        .zip(values.iter())
        .filter_map(|(h, v)| Some((h.as_decimal()? as i32, as_pair(v)?.0)))
        .collect()
}

fn as_f64(v: &ScouterValue) -> Option<f64> {
    match v {
        ScouterValue::Float(f) => Some(*f as f64),
        ScouterValue::Double(d) => Some(*d),
        ScouterValue::Decimal(d) => Some(*d as f64),
        _ => None,
    }
}

/// 값 하나에서 (표시값, 총량) 을 뽑는다.
///
/// **일부 카운터는 스칼라가 아니라 2원소 리스트다** — `HeapTotUsage` = [총량, 사용량],
/// `FdUsage` = [상한, 열린 수] (F-33 실측). ASIS `CounterRTAllPairChart` 가
/// `lv.get(0)`/`lv.get(1)` 을 그렇게 읽는다.
///
/// 예전에는 리스트에 None 을 돌려줘 `filter_map` 이 행을 통째로 버렸고,
/// 그 카운터 차트는 **조용히 빈 채로** 남아 있었다.
fn as_pair(v: &ScouterValue) -> Option<(f64, Option<f64>)> {
    match v {
        ScouterValue::List(items) => match items.len() {
            0 => None,
            // 원소가 하나면 무엇이 총량인지 알 수 없다. 값으로만 쓴다.
            1 => Some((as_f64(&items[0])?, None)),
            // 사람이 보는 건 사용량이다. 총량은 기준선으로 따로 든다.
            _ => Some((as_f64(&items[1])?, as_f64(&items[0]))),
        },
        other => Some((as_f64(other)?, None)),
    }
}

/// MULTI 응답 1행 = (오브젝트, 카운터, 값)
#[derive(Debug, Clone, Serialize)]
pub struct CounterRow {
    pub obj_hash: i32,
    pub counter: String,
    pub value: f64,
    /// 쌍으로 오는 카운터의 총량(상한). 스칼라 카운터에는 없다
    pub total: Option<f64>,
}

/// COUNTER_REAL_TIME_ALL_MULTI 요청 파라미터.
///
/// 카운터당 요청 1회면 F-1(연결당 명령 1개) 때문에 연결이 카운터 수만큼 열린다.
pub fn build_counter_multi_param(obj_hashes: &[i32], counters: &[&str]) -> MapPack {
    let mut param = MapPack::new();
    param.put(
        "counter",
        ScouterValue::List(
            counters.iter().map(|c| ScouterValue::Text(c.to_string())).collect(),
        ),
    );
    param.put(
        "objHash",
        ScouterValue::List(
            obj_hashes.iter().map(|h| ScouterValue::Decimal(*h as i64)).collect(),
        ),
    );
    param
}

/// 응답 MapPack 에서 (objHash, counter, value) 행을 뽑는다.
///
/// **요청한 카운터가 전부 오지는 않는다.** 값이 없으면 빠지므로
/// 순서로 매칭하면 안 되고 `counter` 리스트를 함께 읽어야 한다.
pub fn parse_counter_multi(out: &MapPack) -> Vec<CounterRow> {
    let (
        Some(ScouterValue::List(hashes)),
        Some(ScouterValue::List(names)),
        Some(ScouterValue::List(values)),
    ) = (
        out.entries.get("objHash"),
        out.entries.get("counter"),
        out.entries.get("value"),
    ) else {
        return Vec::new();
    };

    let n = hashes.len().min(names.len()).min(values.len());
    (0..n)
        .filter_map(|i| {
            let (value, total) = as_pair(&values[i])?;
            Some(CounterRow {
                obj_hash: hashes[i].as_decimal()? as i32,
                counter: names[i].as_text()?.to_string(),
                value,
                total,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(vals: Vec<ScouterValue>) -> ScouterValue {
        ScouterValue::List(vals)
    }

    fn multi_response(rows: Vec<(i32, &str, ScouterValue)>) -> MapPack {
        let mut m = MapPack::new();
        m.put(
            "objHash",
            list(rows.iter().map(|(h, _, _)| ScouterValue::Decimal(*h as i64)).collect()),
        );
        m.put(
            "counter",
            list(rows.iter().map(|(_, c, _)| ScouterValue::Text(c.to_string())).collect()),
        );
        m.put("value", list(rows.iter().map(|(_, _, v)| v.clone()).collect()));
        m
    }

    #[test]
    fn scalar_counter_is_parsed() {
        let out = multi_response(vec![(1, "TPS", ScouterValue::Float(16.5))]);
        let rows = parse_counter_multi(&out);
        assert_eq!(rows.len(), 1);
        assert!((rows[0].value - 16.5).abs() < 0.001);
        assert_eq!(rows[0].total, None, "스칼라 카운터에는 총량이 없다");
    }

    #[test]
    fn pair_counter_keeps_both_numbers() {
        // HeapTotUsage 는 [총량, 사용량] 2원소 리스트로 온다 (F-33 실측).
        // 리스트라고 행을 버리면 **차트가 조용히 빈 채로 남는다** — 실제로 그랬다.
        let out = multi_response(vec![(
            1,
            "HeapTotUsage",
            list(vec![ScouterValue::Float(114.0), ScouterValue::Float(44.2)]),
        )]);
        let rows = parse_counter_multi(&out);

        assert_eq!(rows.len(), 1, "리스트 값 행이 버려졌다");
        // 사람이 보는 건 사용량이다. 총량은 기준선으로 따로 든다.
        assert!((rows[0].value - 44.2).abs() < 0.01);
        assert_eq!(rows[0].total, Some(114.0));
    }

    #[test]
    fn fd_usage_pair_is_integer() {
        let out = multi_response(vec![(
            7,
            "FdUsage",
            list(vec![ScouterValue::Decimal(1_048_576), ScouterValue::Decimal(36)]),
        )]);
        let rows = parse_counter_multi(&out);
        assert_eq!(rows[0].value, 36.0);
        assert_eq!(rows[0].total, Some(1_048_576.0));
    }

    #[test]
    fn single_element_list_has_no_total() {
        // 원소가 하나면 무엇이 총량인지 알 수 없다. 값으로만 쓴다.
        let out = multi_response(vec![(1, "X", list(vec![ScouterValue::Float(5.0)]))]);
        let rows = parse_counter_multi(&out);
        assert_eq!(rows[0].value, 5.0);
        assert_eq!(rows[0].total, None);
    }

    #[test]
    fn empty_list_row_is_dropped() {
        // 빈 리스트를 0으로 그리면 없던 골짜기가 생긴다.
        let out = multi_response(vec![(1, "X", list(vec![]))]);
        assert!(parse_counter_multi(&out).is_empty());
    }

    #[test]
    fn pair_value_works_in_single_counter_path_too() {
        // COUNTER_REAL_TIME_ALL(단일 카운터) 응답도 같은 리스트 값을 준다.
        let mut m = MapPack::new();
        m.put("objHash", list(vec![ScouterValue::Decimal(1)]));
        m.put(
            "value",
            list(vec![list(vec![ScouterValue::Float(114.0), ScouterValue::Float(44.2)])]),
        );
        let pairs = parse_counter_values(&m);
        assert_eq!(pairs.len(), 1, "리스트 값이 버려졌다");
        assert!((pairs[0].1 - 44.2).abs() < 0.01);
    }
}
