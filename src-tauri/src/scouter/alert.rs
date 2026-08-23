// 실시간 알람 요청 파라미터
//
// 근거: ASIS AlertConsumer.java:40 (loop + index + objType)
//       AlertPack 필드 순서는 verified-facts.md F-17

use super::pack::MapPack;
use super::streaming::StreamCursor;
use super::value::ScouterValue;

/// ALERT_REAL_TIME 요청 파라미터.
///
/// 커서를 안 보내면 **매 폴링마다 같은 알람이 다시 온다**.
///
/// `objType` 은 일부러 넣지 않는다. 넣으면 그 타입의 알람만 오는데,
/// 오브젝트 생명주기 알람은 `objType=scouter` 라서 `tomcat` 으로 거르면 사라진다 (F-16).
pub fn build_alert_param(cursor: &StreamCursor) -> MapPack {
    let mut param = MapPack::new();
    param.put("loop", ScouterValue::Decimal(cursor.loop_val));
    param.put("index", ScouterValue::Decimal(cursor.index));
    param
}
