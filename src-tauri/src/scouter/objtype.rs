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
/// **못 받은 것이 두 가지다.** 둘을 구별하지 못하면 화면이 «한가하다» 로 잘못 말한다.
///
/// | | 무슨 일 | 응답 |
/// |---|---|---|
/// | `incomplete` | 콜렉터가 에이전트 연결을 제때 못 얻었다 (`S501`) | objHash 만 든 빈 팩 |
/// | `answered` 에 없음 | 콜렉터가 **아예 묻지 않았다** | 팩 자체가 없다 |
///
/// 뒤쪽은 콜렉터가 그 오브젝트를 «살아 있지 않다» 로 볼 때다 —
/// 하트비트(UDP)가 `object_deadtime_ms`(기본 8초) 안에 안 오면 그렇게 된다
/// (코드: `AgentManager.getLiveObjHashList` 가 `alive` 인 것만 돌려준다).
/// 그래서 **답한 오브젝트 목록을 같이 준다.** 부르는 쪽이 «물어봤는데 0건» 과
/// «묻지도 않았다» 를 가를 수 있어야 한다.
#[derive(Debug, Clone, Serialize)]
pub struct TypeActiveServices {
    pub rows: Vec<super::object::ActiveService>,
    pub incomplete: Vec<i32>,
    /// 팩을 하나라도 돌려준 오브젝트. 행이 0건이어도 여기 들어간다
    pub answered: Vec<i32>,
}

/// 한 오브젝트의 시계열. 오늘/과거 카운터 응답이 이 모양이다.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CounterSeries {
    pub obj_hash: i32,
    /// epoch ms. `values` 와 길이가 같다
    pub times: Vec<i64>,
    /// **`None` 은 «그 시각에 값이 없다» 다. 0 이 아니다.**
    ///
    /// 5분 집계(`COUNTER_PAST_DATE_ALL`)는 하루 288칸을 늘 채워 보내고, 수집이 없던
    /// 시각은 Null 로 온다(실측: 오늘 288칸 중 값 있는 것 17칸). 이걸 0 으로 바꾸면
    /// «그때 0 TPS 였다» 가 되는데, 그건 에이전트가 안 붙어 있던 것과 전혀 다른 말이다.
    ///
    /// 구간 조회(`COUNTER_PAST_TIME_ALL`)는 Null 없이 2초 간격 실제 값만 온다(실측).
    pub values: Vec<Option<f32>>,
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

/// 임의 구간 카운터 요청 (`COUNTER_PAST_TIME_ALL`).
///
/// **`date` 가 아니라 `stime`/`etime` 이다.** 파라미터 이름과 순서는 ASIS
/// `CounterPastTimeAllView.load()` 에서 그대로 옮겼다.
/// 대상은 **objType 하나**다 — objHash 목록은 받지 않는다.
pub fn build_past_time_counter_param(
    counter: &str,
    obj_type: &str,
    stime: i64,
    etime: i64,
) -> MapPack {
    let mut param = MapPack::new();
    param.put("stime", ScouterValue::Decimal(stime));
    param.put("etime", ScouterValue::Decimal(etime));
    param.put("objType", ScouterValue::Text(obj_type.to_string()));
    param.put("counter", ScouterValue::Text(counter.to_string()));
    param
}

/// 하루(로컬 자정) 경계로 구간을 쪼갠다.
///
/// **콜렉터는 XLog 도 카운터도 날짜 디렉토리에 담는다.** ASIS 의 webapp 도 날짜를
/// 넘는 요청을 일별로 나눠 순차 조회하고 합친다(05-webapp-service-layer.md).
/// 한 번에 던지면 자정 이전 몫이 조용히 비는데, 그건 «그 시간에 트래픽이 없었다» 로 읽힌다.
///
/// **자정을 넘는 경우는 실측하지 못했다** — 테스트 환경에 어제 데이터가 없다.
/// 하루 안 구간(조각 1개)은 실측했다.
pub fn split_by_day(stime: i64, etime: i64, tz_offset_ms: i64) -> Vec<(i64, i64)> {
    if etime <= stime {
        return Vec::new();
    }
    const DAY: i64 = 86_400_000;
    let mut out = Vec::new();
    let mut cur = stime;
    while cur < etime {
        // 로컬 자정 = UTC 기준 하루 경계에서 시간대만큼 민 자리.
        let local = cur + tz_offset_ms;
        let next_local_midnight = (local / DAY + 1) * DAY;
        let boundary = next_local_midnight - tz_offset_ms;
        let end = boundary.min(etime);
        out.push((cur, end));
        cur = end;
    }
    out
}

/// 콜렉터의 **날짜 디렉토리 키**(`yyyymmdd`).
///
/// XLog 조회는 이 키를 파라미터로 받는다. 틀리면 에러가 아니라 **조용히 0건**이다 —
/// 이 프로토콜의 실패 방식이다(F-15). 화면 쪽은 `timeRange.yyyymmdd` 가 같은 일을 한다.
///
/// **자정이 언제인지는 보는 사람 기준**이므로 시간대를 받아 민다 (F-18).
/// 시간대를 Rust 에서 구하지 않는 이유는 `get_past_counter` 주석과 같다.
pub fn date_key(ms: i64, tz_offset_ms: i64) -> String {
    const DAY: i64 = 86_400_000;
    // 음수(1970 이전)에서도 «며칠째» 가 내림이어야 한다. `/` 는 0 쪽으로 자른다.
    let days = (ms + tz_offset_ms).div_euclid(DAY);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}{m:02}{d:02}")
}

/// 에폭 기준 며칠째 → (년, 월, 일).
///
/// Howard Hinnant 의 `civil_from_days`. **chrono 를 끌어오지 않으려고** 직접 센다 —
/// 이 앱이 날짜에 대해 알아야 할 것은 이 한 줄뿐이다.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    // 3월을 해의 시작으로 옮기면 윤일이 해의 끝에 와서 분기가 사라진다.
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 화면이 그릴 수 있는 만큼으로 줄인다.
///
/// **콜렉터는 2초 간격 원본을 준다.** 6시간이면 오브젝트 하나에 10,800점이고,
/// 서버가 100대면 백만 점이 넘는다 — 실측: 2대·6시간·카운터 3개에 65,298점(약 1.1MB).
/// 100대로 환산하면 56MB 를 IPC 한 번에 실어 나르는 셈이다
/// (CLAUDE.md 3.3: «크거나 잦은 페이로드 지양»).
/// 게다가 화면 폭은 2,000픽셀 남짓이라 그 점들은 **그릴 자리도 없다.**
///
/// 버킷마다 **최댓값과 그 값이 난 시각**을 남긴다.
///   · 평균이 아닌 이유: 이 화면은 «언제 튀었나» 를 보는 곳이다. 평균은 스파이크를
///     뭉개는데, 뭉개고 나면 이 화면을 볼 이유가 없다.
///   · 버킷 중앙 시각이 아닌 이유: 피크가 실제보다 앞뒤로 밀려, 옆 줄과 «같은 순간» 을
///     맞추려는 이 화면의 목적이 무너진다.
///
/// 값이 하나도 없는 버킷은 `None` 으로 남긴다 — 자리를 없애면 시간축이 뭉개진다.
pub fn downsample(series: CounterSeries, max_points: usize) -> CounterSeries {
    let n = series.times.len().min(series.values.len());
    if max_points == 0 || n <= max_points {
        return series;
    }

    let mut times = Vec::with_capacity(max_points);
    let mut values = Vec::with_capacity(max_points);

    for b in 0..max_points {
        // 나눗셈을 곱셈으로 미리 하면 마지막 버킷이 남는 점을 다 가져간다.
        let lo = b * n / max_points;
        let hi = ((b + 1) * n / max_points).max(lo + 1).min(n);

        let mut best: Option<(i64, f32)> = None;
        for i in lo..hi {
            let Some(v) = series.values[i] else { continue };
            if best.is_none_or(|(_, bv)| v > bv) {
                best = Some((series.times[i], v));
            }
        }

        match best {
            Some((t, v)) => {
                times.push(t);
                values.push(Some(v));
            }
            // 값이 하나도 없던 버킷. 자리는 남겨 선이 여기서 끊기게 한다.
            None => {
                times.push(series.times[lo]);
                values.push(None);
            }
        }
    }

    CounterSeries { obj_hash: series.obj_hash, times, values }
}

/// 같은 오브젝트의 조각들을 하나로 잇는다.
///
/// 조각은 **시간순으로 들어와야 한다** — 뒤섞이면 선이 되돌아간다.
/// `split_by_day` 가 시간순으로 주므로 그 순서대로 부르면 된다.
pub fn merge_series(parts: Vec<Vec<CounterSeries>>) -> Vec<CounterSeries> {
    let mut order: Vec<i32> = Vec::new();
    let mut by_hash: std::collections::HashMap<i32, CounterSeries> =
        std::collections::HashMap::new();

    for part in parts {
        for s in part {
            match by_hash.get_mut(&s.obj_hash) {
                Some(acc) => {
                    acc.times.extend(s.times);
                    acc.values.extend(s.values);
                }
                None => {
                    order.push(s.obj_hash);
                    by_hash.insert(s.obj_hash, s);
                }
            }
        }
    }

    // **받은 순서를 지킨다.** HashMap 순회 순서로 내보내면 실행할 때마다
    // 선 색이 뒤바뀌어, 같은 화면을 두 번 열면 다른 서버가 파란색이 된다.
    order
        .into_iter()
        .filter_map(|h| by_hash.remove(&h))
        .collect()
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
    let values: Vec<Option<f32>> = match map.entries.get("value") {
        Some(ScouterValue::List(items)) => items
            .iter()
            .map(|v| match v {
                // **Null 을 0 으로 바꾸지 않는다.** 없는 것과 0 은 다른 말이다.
                ScouterValue::Null => None,
                ScouterValue::Float(f) => Some(*f),
                ScouterValue::Double(d) => Some(*d as f32),
                other => other.as_decimal().map(|d| d as f32),
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

    const KST: i64 = 9 * 3_600_000;

    #[test]
    fn past_time_param_uses_stime_etime() {
        // ASIS CounterPastTimeAllView.load() 와 같은 네 칸이어야 한다.
        let p = build_past_time_counter_param("TPS", "tomcat", 100, 200);
        assert_eq!(p.get_decimal("stime"), Some(100));
        assert_eq!(p.get_decimal("etime"), Some(200));
        assert!(matches!(p.entries.get("objType"), Some(ScouterValue::Text(t)) if t == "tomcat"));
        assert!(matches!(p.entries.get("counter"), Some(ScouterValue::Text(t)) if t == "TPS"));
        // date 를 같이 넣으면 안 된다 — 커맨드가 다르다.
        assert!(!p.entries.contains_key("date"));
    }

    #[test]
    fn split_keeps_one_piece_within_a_day() {
        // 2025-09-06 10:00 ~ 12:00 KST
        let s = 1_757_120_400_000;
        let e = s + 2 * 3_600_000;
        assert_eq!(split_by_day(s, e, KST), vec![(s, e)]);
    }

    #[test]
    fn split_cuts_at_local_midnight() {
        // 자정 30분 전에서 시작해 30분 뒤에 끝나면 두 조각이다.
        const DAY: i64 = 86_400_000;
        let midnight = (1_757_120_400_000 + KST) / DAY * DAY + DAY - KST;
        let s = midnight - 1_800_000;
        let e = midnight + 1_800_000;
        assert_eq!(split_by_day(s, e, KST), vec![(s, midnight), (midnight, e)]);
    }

    #[test]
    fn date_key_uses_the_viewers_midnight() {
        // 2025-09-06 10:00 KST. UTC 로는 아직 09-06 01:00 이라 같은 날이지만,
        // 자정 직후 30분은 UTC 로 «어제» 다 — 그때 어제 디렉토리를 뒤지면 0건이다.
        let ten_am = 1_757_120_400_000;
        assert_eq!(date_key(ten_am, KST), "20250906");

        const DAY: i64 = 86_400_000;
        let midnight = (ten_am + KST) / DAY * DAY + DAY - KST;
        assert_eq!(date_key(midnight, KST), "20250907", "자정 이후는 다음 날이다");
        assert_eq!(date_key(midnight - 1, KST), "20250906");
        // 같은 순간이라도 시간대가 다르면 날짜가 갈린다.
        assert_eq!(date_key(midnight, 0), "20250906");
    }

    #[test]
    fn date_key_handles_month_and_leap_boundaries() {
        // 손으로 짠 날짜 계산이라 경계를 박아 둔다.
        assert_eq!(date_key(0, 0), "19700101");
        // 2024-02-29 12:00 UTC — 윤일
        assert_eq!(date_key(1_709_208_000_000, 0), "20240229");
        // 2023-03-01 00:00 UTC — 윤일 없는 해의 3월 1일
        assert_eq!(date_key(1_677_628_800_000, 0), "20230301");
        // 2025-12-31 23:59:59 UTC → 시간대를 밀면 다음 해로 넘어간다
        assert_eq!(date_key(1_767_225_599_000, 0), "20251231");
        assert_eq!(date_key(1_767_225_599_000, KST), "20260101");
    }

    #[test]
    fn split_rejects_empty_range() {
        // 요청을 던져 봐야 0건이다. 여기서 걸러 연결을 아낀다.
        assert!(split_by_day(100, 100, KST).is_empty());
        assert!(split_by_day(200, 100, KST).is_empty());
    }

    #[test]
    fn split_covers_the_whole_range_without_gaps() {
        // 조각 사이가 벌어지면 그 구간이 조용히 빈다.
        let s = 1_757_000_000_000;
        let e = s + 3 * 86_400_000 + 12_345;
        let parts = split_by_day(s, e, KST);
        assert_eq!(parts.first().unwrap().0, s);
        assert_eq!(parts.last().unwrap().1, e);
        for w in parts.windows(2) {
            assert_eq!(w[0].1, w[1].0, "조각 사이가 벌어졌다");
        }
    }

    fn ser(values: Vec<Option<f32>>) -> CounterSeries {
        CounterSeries {
            obj_hash: 11,
            times: (0..values.len() as i64).map(|i| i * 2_000).collect(),
            values,
        }
    }

    #[test]
    fn downsample_leaves_short_series_alone() {
        // 1시간(1,800점)은 화면 폭 안이라 줄일 이유가 없다.
        let s = ser(vec![Some(1.0), Some(2.0), Some(3.0)]);
        assert_eq!(downsample(s.clone(), 10), s);
        assert_eq!(downsample(s.clone(), 3), s);
    }

    #[test]
    fn downsample_keeps_the_peak_not_the_average() {
        // **평균은 스파이크를 뭉갠다.** 뭉개고 나면 이 화면을 볼 이유가 없다.
        let s = ser(vec![Some(1.0), Some(9.0), Some(1.0), Some(1.0)]);
        let out = downsample(s, 2);
        assert_eq!(out.values, vec![Some(9.0), Some(1.0)]);
    }

    #[test]
    fn downsample_keeps_the_time_the_peak_happened() {
        // 버킷 중앙 시각을 쓰면 피크가 앞뒤로 밀려, 옆 줄과 «같은 순간» 을 못 맞춘다.
        let s = ser(vec![Some(1.0), Some(9.0), Some(1.0), Some(1.0)]);
        let out = downsample(s, 2);
        assert_eq!(out.times[0], 2_000, "9.0 이 난 시각이어야 한다");
    }

    #[test]
    fn downsample_hits_the_requested_size() {
        let s = ser((0..1_000).map(|i| Some(i as f32)).collect());
        assert_eq!(downsample(s, 100).times.len(), 100);
    }

    #[test]
    fn downsample_marks_empty_buckets_as_missing() {
        // 값이 하나도 없던 구간을 0 으로 채우면 없던 골짜기가 생긴다.
        let s = ser(vec![Some(1.0), None, None, Some(4.0)]);
        let out = downsample(s, 2);
        assert_eq!(out.values, vec![Some(1.0), Some(4.0)]);

        let s2 = ser(vec![None, None, Some(4.0), Some(5.0)]);
        let out2 = downsample(s2, 2);
        assert_eq!(out2.values, vec![None, Some(5.0)]);
        // 자리는 남긴다 — 없애면 시간축이 뭉개진다.
        assert_eq!(out2.times.len(), 2);
    }

    #[test]
    fn downsample_covers_every_point() {
        // 버킷이 겹치거나 벌어지면 마지막 몇 점이 통째로 사라진다.
        let s = ser((0..7).map(|i| Some(i as f32)).collect());
        let out = downsample(s, 3);
        // 마지막 버킷이 남는 점을 가져가므로 최댓값 6 이 살아야 한다.
        assert_eq!(out.values.last(), Some(&Some(6.0)));
    }

    #[test]
    fn downsample_ignores_zero_size() {
        // 0 으로 나누면 패닉이다. 줄이지 않는 쪽이 안전하다.
        let s = ser(vec![Some(1.0), Some(2.0)]);
        assert_eq!(downsample(s.clone(), 0), s);
    }

    #[test]
    fn merge_joins_pieces_of_the_same_object() {
        let a = CounterSeries { obj_hash: 11, times: vec![1, 2], values: vec![Some(1.0), Some(2.0)] };
        let b = CounterSeries { obj_hash: 11, times: vec![3], values: vec![Some(3.0)] };
        let out = merge_series(vec![vec![a], vec![b]]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].times, vec![1, 2, 3]);
        assert_eq!(out[0].values, vec![Some(1.0), Some(2.0), Some(3.0)]);
    }

    #[test]
    fn merge_keeps_the_order_it_received() {
        // HashMap 순회 순서로 내보내면 같은 화면을 두 번 열 때 선 색이 뒤바뀐다.
        let mk = |h: i32| CounterSeries { obj_hash: h, times: vec![1], values: vec![Some(1.0)] };
        let out = merge_series(vec![vec![mk(22), mk(11), mk(33)]]);
        assert_eq!(out.iter().map(|s| s.obj_hash).collect::<Vec<_>>(), vec![22, 11, 33]);
    }

    #[test]
    fn merge_keeps_objects_that_appear_late() {
        // 새 서버가 구간 중간에 올라오면 뒷 조각에만 있다. 버리면 그 선이 통째로 사라진다.
        let mk = |h: i32| CounterSeries { obj_hash: h, times: vec![1], values: vec![Some(1.0)] };
        let out = merge_series(vec![vec![mk(11)], vec![mk(11), mk(22)]]);
        assert_eq!(out.len(), 2);
    }

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
        assert!(!p.entries.contains_key("date"), "오늘 조회에 date 는 없다");
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
        assert_eq!(s.values, vec![Some(1.5), Some(2.5)]);
        assert_eq!(s.obj_hash, 16367847);
    }

    #[test]
    fn counter_series_keeps_null_as_missing() {
        // 5분 집계는 하루 288칸을 늘 채워 보내고 수집이 없던 시각은 Null 로 온다
        // (실측: 오늘 288칸 중 값 있는 것 17칸). **0 으로 바꾸면 «그때 0 TPS 였다» 가 된다** —
        // 에이전트가 안 붙어 있던 것과 전혀 다른 말이다.
        let m = map(vec![
            ("objHash", ScouterValue::Decimal(11)),
            (
                "time",
                ScouterValue::List(vec![ScouterValue::Decimal(1_000), ScouterValue::Decimal(2_000)]),
            ),
            (
                "value",
                ScouterValue::List(vec![ScouterValue::Null, ScouterValue::Float(2.5)]),
            ),
        ]);
        let s = parse_counter_series(&m);
        assert_eq!(s.values, vec![None, Some(2.5)]);
        // 자리는 지킨다 — 빼 버리면 시각과 값이 어긋난다.
        assert_eq!(s.times.len(), s.values.len());
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
/// **`complete` 가 없으면 응답하지 않은 것이다.** 예전에는 없음을 «완료» 로 봤는데
/// 바이트코드로 보니 반대였다:
///   - 에이전트(`AgentThread.activeThreadList`)는 건수와 무관하게 **늘** `complete=true` 를
///     넣는다 — 한가해서 0건이어도 넣는다 (오프셋 591, 유일한 정상 종료 경로).
///   - 콜렉터(`ThreadList.agentActiveServiceList`)는 에이전트 세션을
///     `net_tcp_get_agent_connection_wait_ms`(기본 1초) 안에 못 얻으면 `S501` 을 남기고
///     **objHash 만 든 팩**을 보낸다.
///
/// 없음을 완료로 보면 그 서버의 행이 경고 없이 사라진다 — 갱신마다 떴다 사라졌다 하던
/// 현상의 절반이 이것이었다. `probe_active_service_short_wait` 가 실물로 재현한다.
pub fn is_complete(map: &MapPack) -> bool {
    matches!(map.entries.get("complete"), Some(ScouterValue::Boolean(true)))
}

#[cfg(test)]
mod active_service_tests {
    use super::*;

    #[test]
    fn objtype_only_asks_the_whole_type() {
        let p = build_active_service_param("tomcat", None);
        assert_eq!(p.get_text("objType"), Some("tomcat"));
        // objHash 를 0으로라도 넣으면 결과가 달라진다 (실측). 아예 넣지 않는다.
        assert!(!p.entries.contains_key("objHash"));
    }

    #[test]
    fn objhash_narrows_to_one_object() {
        let p = build_active_service_param("tomcat", Some(-1585387669));
        assert_eq!(p.get_decimal("objHash"), Some(-1585387669));
    }

    #[test]
    fn missing_complete_flag_means_the_agent_was_not_reached() {
        // 에이전트는 0건이어도 complete=true 를 넣는다. 없는 것은 콜렉터가 세션을 못 얻어
        // objHash 만 채워 보낸 팩이다 — 이걸 완료로 보면 행이 경고 없이 사라진다.
        let mut unreached = MapPack::new();
        unreached.put("objHash", ScouterValue::Decimal(42));
        assert!(!is_complete(&unreached));
    }

    #[test]
    fn idle_agent_with_complete_flag_is_complete() {
        // 한가한 서버에 거짓 경고가 붙으면 안 된다.
        let mut idle = MapPack::new();
        idle.put("complete", ScouterValue::Boolean(true));
        assert!(is_complete(&idle));
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
        assert!(!p.entries.contains_key("objType"));
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
