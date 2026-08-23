// objType 단위 조회 (액티브 서비스 / 오늘 누적)
//
// 지금까지의 카운터는 "오브젝트 하나"가 기준이었다. 여기 있는 것들은 **타입 전체**가
// 기준이다 — tomcat 전체의 액티브 서비스, 오늘 하루 누적 서비스 수, 오늘 방문자.
//
// 파라미터는 전부 `objType` 하나다. 실측으로 확인한 응답 모양:
//
// | 커맨드 | 응답 |
// |---|---|
// | `ACTIVESPEED_REAL_TIME` | 오브젝트당 MapPack: `act1/act2/act3/objHash` |
// | `ACTIVESPEED_REAL_TIME_GROUP` | MapPack 1개: `act1/act2/act3/tps`(Float) |
// | `COUNTER_TODAY_ALL` | 오브젝트당 MapPack: `objHash/time[]/value[]` |
// | `VISITOR_REALTIME_TOTAL` | **Pack 이 아니라 Value 하나** (F-32) |

use serde::Serialize;

use super::pack::MapPack;
use super::value::ScouterValue;

/// 액티브 서비스 단계별 수.
///
/// ASIS 는 이 셋을 색으로 나눠 쌓는다 — 1초 미만 / 1~3초 / 3초 이상.
/// **합계만 보면 안 된다.** 총 10건이어도 전부 act3 면 장애다.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct ActiveSpeed {
    /// GROUP 응답에는 없다 (타입 전체 합계라서)
    pub obj_hash: i32,
    /// 1초 미만
    pub act1: i32,
    /// 1~3초
    pub act2: i32,
    /// 3초 이상
    pub act3: i32,
    /// 타입 전체 TPS. GROUP 응답에만 있다
    pub tps: f32,
}

/// 타입 전체의 액티브 서비스 목록.
///
/// `incomplete` 는 **끝까지 응답하지 못한 오브젝트**다. 조용히 적게 보여주면
/// "지금 한가하다"로 오해한다.
#[derive(Debug, Clone, Serialize)]
pub struct TypeActiveServices {
    pub rows: Vec<super::object::ActiveService>,
    pub incomplete: Vec<i32>,
}

/// 한 오브젝트의 시계열. 오늘/과거 카운터 응답이 이 모양이다.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CounterSeries {
    pub obj_hash: i32,
    /// epoch ms. `values` 와 길이가 같다
    pub times: Vec<i64>,
    pub values: Vec<f32>,
}

/// objType 하나만 넣는 요청
pub fn build_objtype_param(obj_type: &str) -> MapPack {
    let mut param = MapPack::new();
    param.put("objType", ScouterValue::Text(obj_type.to_string()));
    param
}

/// 오늘 누적 카운터 요청. **`counter` 는 counters.xml 표기 그대로여야 한다** (F-15)
pub fn build_today_counter_param(counter: &str, obj_type: &str) -> MapPack {
    let mut param = MapPack::new();
    param.put("counter", ScouterValue::Text(counter.to_string()));
    param.put("objType", ScouterValue::Text(obj_type.to_string()));
    param
}

/// 과거 날짜 누적 카운터 요청
pub fn build_past_date_counter_param(counter: &str, obj_type: &str, date: &str) -> MapPack {
    let mut param = build_today_counter_param(counter, obj_type);
    param.put("date", ScouterValue::Text(date.to_string()));
    param
}

fn as_i32(map: &MapPack, key: &str) -> i32 {
    map.get_decimal(key).unwrap_or(0) as i32
}

pub fn parse_active_speed(map: &MapPack) -> ActiveSpeed {
    ActiveSpeed {
        obj_hash: as_i32(map, "objHash"),
        act1: as_i32(map, "act1"),
        act2: as_i32(map, "act2"),
        act3: as_i32(map, "act3"),
        // GROUP 응답에서 Float 로 온다. 없으면 0.
        tps: map
            .entries
            .get("tps")
            .and_then(|v| match v {
                ScouterValue::Float(f) => Some(*f),
                ScouterValue::Double(d) => Some(*d as f32),
                other => other.as_decimal().map(|d| d as f32),
            })
            .unwrap_or(0.0),
    }
}

/// 시계열 파싱.
///
/// **time 과 value 는 길이가 다를 수 있다.** 짧은 쪽에 맞춰 자른다 —
/// 안 자르면 없는 값을 0으로 그려 실제로 없던 골짜기가 생긴다.
pub fn parse_counter_series(map: &MapPack) -> CounterSeries {
    let times: Vec<i64> = match map.entries.get("time") {
        Some(ScouterValue::List(items)) => {
            items.iter().filter_map(|v| v.as_decimal()).collect()
        }
        _ => Vec::new(),
    };
    let values: Vec<f32> = match map.entries.get("value") {
        Some(ScouterValue::List(items)) => items
            .iter()
            .map(|v| match v {
                ScouterValue::Float(f) => *f,
                ScouterValue::Double(d) => *d as f32,
                other => other.as_decimal().unwrap_or(0) as f32,
            })
            .collect(),
        _ => Vec::new(),
    };

    let n = times.len().min(values.len());
    CounterSeries {
        obj_hash: as_i32(map, "objHash"),
        times: times[..n].to_vec(),
        values: values[..n].to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(pairs: Vec<(&str, ScouterValue)>) -> MapPack {
        let mut m = MapPack::new();
        for (k, v) in pairs {
            m.put(k, v);
        }
        m
    }

    #[test]
    fn objtype_param_carries_only_objtype() {
        let p = build_objtype_param("tomcat");
        assert_eq!(p.get_text("objType"), Some("tomcat"));
        assert_eq!(p.entries.len(), 1);
    }

    #[test]
    fn today_counter_param_needs_counter_and_objtype() {
        // counter 를 빼면 에러가 아니라 0건이 온다 (F-15).
        let p = build_today_counter_param("ServiceCount", "tomcat");
        assert_eq!(p.get_text("counter"), Some("ServiceCount"));
        assert_eq!(p.get_text("objType"), Some("tomcat"));
        assert!(p.entries.get("date").is_none(), "오늘 조회에 date 는 없다");
    }

    #[test]
    fn past_date_param_adds_date() {
        let p = build_past_date_counter_param("ServiceCount", "tomcat", "20260817");
        assert_eq!(p.get_text("date"), Some("20260817"));
        assert_eq!(p.get_text("counter"), Some("ServiceCount"));
    }

    #[test]
    fn active_speed_keeps_three_steps_apart() {
        // 합계로 뭉개면 "전부 3초 이상" 인 상황이 안 보인다.
        let m = map(vec![
            ("objHash", ScouterValue::Decimal(-1585387669)),
            ("act1", ScouterValue::Decimal(2)),
            ("act2", ScouterValue::Decimal(1)),
            ("act3", ScouterValue::Decimal(7)),
        ]);
        let a = parse_active_speed(&m);
        assert_eq!((a.act1, a.act2, a.act3), (2, 1, 7));
        assert_eq!(a.obj_hash, -1585387669);
    }

    #[test]
    fn group_response_carries_float_tps() {
        // GROUP 만 tps 를 준다. Float 이라 Decimal 로 읽으면 잃는다.
        let m = map(vec![
            ("act1", ScouterValue::Decimal(2)),
            ("act2", ScouterValue::Decimal(0)),
            ("act3", ScouterValue::Decimal(0)),
            ("tps", ScouterValue::Float(24.933334)),
        ]);
        let a = parse_active_speed(&m);
        assert!((a.tps - 24.933334).abs() < 0.001, "tps={}", a.tps);
        // GROUP 응답에는 objHash 가 없다.
        assert_eq!(a.obj_hash, 0);
    }

    #[test]
    fn missing_tps_is_zero_not_error() {
        // 오브젝트별 응답에는 tps 가 없다. 그렇다고 실패시키면 EQ 화면이 통째로 빈다.
        let a = parse_active_speed(&map(vec![("act1", ScouterValue::Decimal(1))]));
        assert_eq!(a.tps, 0.0);
    }

    #[test]
    fn counter_series_pairs_time_and_value() {
        let m = map(vec![
            ("objHash", ScouterValue::Decimal(16367847)),
            (
                "time",
                ScouterValue::List(vec![
                    ScouterValue::Decimal(1_000),
                    ScouterValue::Decimal(2_000),
                ]),
            ),
            (
                "value",
                ScouterValue::List(vec![ScouterValue::Float(1.5), ScouterValue::Float(2.5)]),
            ),
        ]);
        let s = parse_counter_series(&m);
        assert_eq!(s.times, vec![1_000, 2_000]);
        assert_eq!(s.values, vec![1.5, 2.5]);
        assert_eq!(s.obj_hash, 16367847);
    }

    #[test]
    fn counter_series_truncates_to_shorter_side() {
        // 길이가 어긋난 채 그리면 **없던 골짜기**가 생긴다.
        let m = map(vec![
            (
                "time",
                ScouterValue::List(vec![
                    ScouterValue::Decimal(1),
                    ScouterValue::Decimal(2),
                    ScouterValue::Decimal(3),
                ]),
            ),
            ("value", ScouterValue::List(vec![ScouterValue::Float(9.0)])),
        ]);
        let s = parse_counter_series(&m);
        assert_eq!(s.times.len(), 1);
        assert_eq!(s.values.len(), 1);
    }

    #[test]
    fn counter_series_without_lists_is_empty() {
        let s = parse_counter_series(&map(vec![("objHash", ScouterValue::Decimal(1))]));
        assert!(s.times.is_empty() && s.values.is_empty());
    }
}

// ─── 타입 전체 액티브 서비스 ─────────────────────────────────

/// `OBJECT_ACTIVE_SERVICE_LIST` 파라미터.
///
/// **`objType` 만 보내면 그 타입 전체가 한 번에 온다** (오브젝트당 MapPack 1개, F-34).
/// `obj_hash` 를 주면 그 오브젝트만. 0을 넣으면 안 된다 — 실측에서 결과가 달라졌다.
pub fn build_active_service_param(obj_type: &str, obj_hash: Option<i32>) -> MapPack {
    let mut param = build_objtype_param(obj_type);
    if let Some(h) = obj_hash {
        param.put("objHash", ScouterValue::Decimal(h as i64));
    }
    param
}

/// 응답 pack 하나가 "그 오브젝트는 끝까지 응답했는가"를 함께 알려준다.
///
/// `complete=false` 면 그 에이전트의 목록이 **잘렸다는 뜻**이다.
/// 조용히 적게 보여주면 "지금 한가하다"로 오해한다.
pub fn is_complete(map: &MapPack) -> bool {
    matches!(map.entries.get("complete"), Some(ScouterValue::Boolean(true)) | None)
}

#[cfg(test)]
mod active_service_tests {
    use super::*;

    #[test]
    fn objtype_only_asks_the_whole_type() {
        let p = build_active_service_param("tomcat", None);
        assert_eq!(p.get_text("objType"), Some("tomcat"));
        // objHash 를 0으로라도 넣으면 결과가 달라진다 (실측). 아예 넣지 않는다.
        assert!(p.entries.get("objHash").is_none());
    }

    #[test]
    fn objhash_narrows_to_one_object() {
        let p = build_active_service_param("tomcat", Some(-1585387669));
        assert_eq!(p.get_decimal("objHash"), Some(-1585387669));
    }

    #[test]
    fn missing_complete_flag_counts_as_complete() {
        // 플래그가 없다고 "잘렸다"로 표시하면 멀쩡한 목록에 경고가 붙는다.
        assert!(is_complete(&MapPack::new()));
    }

    #[test]
    fn explicit_false_is_incomplete() {
        let mut m = MapPack::new();
        m.put("complete", ScouterValue::Boolean(false));
        assert!(!is_complete(&m));
    }
}

// ─── 서비스 그룹 ─────────────────────────────────────────────

/// URL 앞부분으로 묶은 서비스 한 덩어리.
///
/// 콜렉터가 최근 30초의 XLog 를 이름 규칙으로 묶어 준다 —
/// 실측 응답: `/order` `/shop` `/**` (안 묶인 것은 `/**` 로 떨어진다).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ServiceGroupRow {
    pub name: String,
    /// 30초 동안의 호출 수. **TPS 가 아니다** — `tps()` 로 나눠야 한다
    pub count: i64,
    /// 평균 응답시간(ms). 콜렉터가 이미 평균 낸 값이다.
    ///
    /// **Float 으로 온다.** `as_decimal()` 로 읽으면 조용히 0이 되어
    /// 응답시간 칸이 전부 0ms 가 된다 — 실제로 겪었다 (F-44).
    pub elapsed: f64,
    pub error: i64,
}

impl ServiceGroupRow {
    /// 응답은 **30초 구간의 누적 건수**다. 그대로 TPS 라고 그리면 30배 부풀려진다
    /// (ASIS `AbstractServiceGroupTPSView` 도 30으로 나눈다).
    pub fn tps(&self) -> f64 {
        self.count as f64 / 30.0
    }
}

/// `REALTIME_SERVICE_GROUP` 파라미터.
///
/// **`objType` 이 아니라 `objHash` 목록이다.** objType 으로 물으면 에러 없이
/// 0건이 온다 (F-15). ASIS `ServiceGroupTPSView.fetch()` 가 근거다.
pub fn build_service_group_param(obj_hashes: &[i32]) -> MapPack {
    let mut param = MapPack::new();
    param.put(
        "objHash",
        ScouterValue::List(obj_hashes.iter().map(|h| ScouterValue::Decimal(*h as i64)).collect()),
    );
    param
}

/// 응답은 `name` `count` `elapsed` `error` 네 병렬 리스트다.
///
/// 길이가 어긋나면 짧은 쪽에 맞춘다 — 인덱스가 밀리면 `/shop` 의 건수에
/// `/order` 의 응답시간이 붙는다.
pub fn parse_service_group(map: &MapPack) -> Vec<ServiceGroupRow> {
    let list = |key: &str| match map.entries.get(key) {
        Some(ScouterValue::List(v)) => v.as_slice(),
        _ => &[][..],
    };
    let names = list("name");
    let counts = list("count");
    let elapsed = list("elapsed");
    let errors = list("error");

    let n = names.len().min(counts.len()).min(elapsed.len()).min(errors.len());
    (0..n)
        .map(|i| ServiceGroupRow {
            name: names[i].as_text().unwrap_or("").to_string(),
            // 세 숫자 전부 `as_number` 로 읽는다. 실측에서 count/error 는 Decimal,
            // elapsed 는 Float 이었다 — 필드마다 타입을 외우고 있을 이유가 없다.
            count: counts[i].as_number().unwrap_or(0.0) as i64,
            elapsed: elapsed[i].as_number().unwrap_or(0.0),
            error: errors[i].as_number().unwrap_or(0.0) as i64,
        })
        .collect()
}

#[cfg(test)]
mod service_group_tests {
    use super::*;

    fn lv(v: &[i64]) -> ScouterValue {
        ScouterValue::List(v.iter().map(|x| ScouterValue::Decimal(*x)).collect())
    }
    fn tv(v: &[&str]) -> ScouterValue {
        ScouterValue::List(v.iter().map(|x| ScouterValue::Text((*x).to_string())).collect())
    }

    #[test]
    fn param_is_objhash_list_not_objtype() {
        // objType 으로 물으면 에러 없이 0건이 온다 (실측).
        let p = build_service_group_param(&[-1585387669, 16367847]);
        assert!(p.entries.get("objType").is_none());
        match p.entries.get("objHash") {
            Some(ScouterValue::List(v)) => assert_eq!(v.len(), 2),
            other => panic!("objHash 가 리스트가 아니다: {other:?}"),
        }
    }

    #[test]
    fn parses_four_parallel_lists() {
        let mut m = MapPack::new();
        m.put("name", tv(&["/shop", "/order"]));
        m.put("count", lv(&[458, 213]));
        m.put("elapsed", lv(&[12, 30]));
        m.put("error", lv(&[0, 2]));
        let rows = parse_service_group(&m);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].name, "/shop");
        assert_eq!(rows[0].count, 458);
        assert_eq!(rows[1].error, 2);
    }

    #[test]
    fn elapsed_comes_as_float_not_decimal() {
        // **실측에서 Float 으로 왔다.** as_decimal 로 읽으면 조용히 0이 되어
        // 응답시간 칸이 전부 0ms 가 된다 (실제로 겪었다).
        let mut m = MapPack::new();
        m.put("name", tv(&["/shop"]));
        m.put("count", lv(&[460]));
        m.put(
            "elapsed",
            ScouterValue::List(vec![ScouterValue::Float(77.11039)]),
        );
        m.put("error", lv(&[17]));
        let rows = parse_service_group(&m);
        assert!((rows[0].elapsed - 77.11039).abs() < 1e-4, "elapsed={}", rows[0].elapsed);
    }

    #[test]
    fn truncates_to_shortest_list() {
        // 인덱스가 밀리면 /shop 의 건수에 /order 의 응답시간이 붙는다.
        let mut m = MapPack::new();
        m.put("name", tv(&["/shop", "/order"]));
        m.put("count", lv(&[458]));
        m.put("elapsed", lv(&[12, 30]));
        m.put("error", lv(&[0, 2]));
        assert_eq!(parse_service_group(&m).len(), 1);
    }

    #[test]
    fn missing_lists_are_empty_not_panic() {
        assert!(parse_service_group(&MapPack::new()).is_empty());
    }

    #[test]
    fn tps_divides_by_thirty_second_window() {
        // 그대로 TPS 라고 그리면 30배 부풀려진다.
        let r = ServiceGroupRow { name: "/shop".into(), count: 450, elapsed: 0.0, error: 0 };
        assert!((r.tps() - 15.0).abs() < 1e-9);
    }
}
