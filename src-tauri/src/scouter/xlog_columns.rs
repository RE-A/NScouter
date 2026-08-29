// 실시간 XLog 를 웹뷰로 보낼 때의 모양.
//
// **왜 열(column) 인가 — 재 보고 정했다.**
//
// 첫 폴링은 10,000건이 온다. 그걸 `XLogPack` 배열 그대로 보내면 JSON 직렬화에만
// 0.6초가 든다. 처음에는 «IPC 호출이 잦아서» 라고 보고 건별 emit 을 500건씩 묶었는데
// **거의 안 줄었다**(590ms → 501ms). 비용은 호출 횟수가 아니라 **직렬화**였다.
//
// 같은 배치(10,000건)를 세 가지로 재 본 값:
//
// | 모양 | 직렬화 | JSON 크기 |
// |---|---|---|
// | `XLogPack` 배열 (필드 40개) | 585ms | 7,078KB |
// | 화면이 쓰는 것만 (필드 17개) | 214ms | 3,091KB |
// | **열 단위 (필드 17개)** | **105ms** | **1,327KB** |
//
// 두 가지가 겹쳐서 줄었다:
//   1. **안 쓰는 필드 23개를 안 보낸다.** `text1`~`text5` · `country_code` · `referer` …
//      화면(`SXLog`)이 쓰는 건 17개뿐인데 40개를 보내고 있었다.
//   2. **필드 이름을 1만 번 반복하지 않는다.** 객체 배열은 레코드마다 키를 다시 쓴다.
//
// 열로 보내면 화면에서 다시 객체로 엮어야 하지만, 그건 JS 쪽에서 싸다 —
// 어차피 `xlogPackToSXLog` 로 한 번 만들고 있었다.
//
// **길이가 어긋나면 안 된다.** 열이 17개라 하나만 빠뜨려도 그 뒤가 통째로 밀린다.
// `from()` 에서 한 번에 채우고, 화면은 `end_time.length` 를 기준으로 읽는다.

use serde::Serialize;

use super::pack::XLogPack;

/// 한 묶음의 XLog. **행이 아니라 열로 담는다** (이유는 파일 머리 참고).
///
/// 모든 `Vec` 의 길이는 같다. `txid`/`caller`/`gxid` 는 i64 라 JS 가 정확히 못 담아
/// 문자열로 보낸다(기존 `XLogPack` 과 같은 규칙).
#[derive(Serialize, Default, Clone)]
pub struct XLogColumns {
    pub txid: Vec<String>,
    pub gxid: Vec<String>,
    pub caller: Vec<String>,
    pub end_time: Vec<i64>,
    pub elapsed: Vec<i32>,
    pub obj_hash: Vec<i32>,
    pub service: Vec<i32>,
    pub error: Vec<i32>,
    pub x_type: Vec<u8>,
    pub cpu: Vec<i32>,
    pub sql_count: Vec<i32>,
    pub sql_time: Vec<i32>,
    pub apicall_count: Vec<i32>,
    pub apicall_time: Vec<i32>,
    pub ipaddr: Vec<String>,
    pub kbytes: Vec<i32>,
    pub thread_name_hash: Vec<i32>,
}

impl XLogColumns {
    pub fn len(&self) -> usize {
        self.end_time.len()
    }

    pub fn is_empty(&self) -> bool {
        self.end_time.is_empty()
    }
}

impl From<Vec<XLogPack>> for XLogColumns {
    fn from(rows: Vec<XLogPack>) -> Self {
        let n = rows.len();
        let mut c = XLogColumns {
            txid: Vec::with_capacity(n),
            gxid: Vec::with_capacity(n),
            caller: Vec::with_capacity(n),
            end_time: Vec::with_capacity(n),
            elapsed: Vec::with_capacity(n),
            obj_hash: Vec::with_capacity(n),
            service: Vec::with_capacity(n),
            error: Vec::with_capacity(n),
            x_type: Vec::with_capacity(n),
            cpu: Vec::with_capacity(n),
            sql_count: Vec::with_capacity(n),
            sql_time: Vec::with_capacity(n),
            apicall_count: Vec::with_capacity(n),
            apicall_time: Vec::with_capacity(n),
            ipaddr: Vec::with_capacity(n),
            kbytes: Vec::with_capacity(n),
            thread_name_hash: Vec::with_capacity(n),
        };
        for p in rows {
            c.txid.push(p.txid.to_string());
            c.gxid.push(p.gxid.to_string());
            c.caller.push(p.caller.to_string());
            c.end_time.push(p.end_time);
            c.elapsed.push(p.elapsed);
            c.obj_hash.push(p.obj_hash);
            c.service.push(p.service);
            c.error.push(p.error);
            c.x_type.push(p.x_type);
            c.cpu.push(p.cpu);
            c.sql_count.push(p.sql_count);
            c.sql_time.push(p.sql_time);
            c.apicall_count.push(p.apicall_count);
            c.apicall_time.push(p.apicall_time);
            c.ipaddr.push(p.ipaddr);
            c.kbytes.push(p.kbytes);
            c.thread_name_hash.push(p.thread_name_hash);
        }
        c
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pack(txid: i64, elapsed: i32) -> XLogPack {
        XLogPack {
            txid,
            gxid: txid + 1,
            caller: txid + 2,
            end_time: 1_700_000_000_000 + txid,
            elapsed,
            obj_hash: 7,
            service: 9,
            error: 0,
            x_type: 1,
            cpu: 3,
            sql_count: 2,
            sql_time: 11,
            apicall_count: 1,
            apicall_time: 22,
            ipaddr: "10.0.0.1".to_string(),
            kbytes: 4,
            thread_name_hash: 55,
            ..Default::default()
        }
    }

    #[test]
    fn 열_길이가_전부_같다() {
        // **하나만 빠뜨려도 그 뒤가 통째로 밀린다.** 화면은 end_time 길이로 읽는다.
        let c = XLogColumns::from(vec![pack(1, 10), pack(2, 20), pack(3, 30)]);
        assert_eq!(c.len(), 3);
        assert_eq!(c.txid.len(), 3);
        assert_eq!(c.gxid.len(), 3);
        assert_eq!(c.caller.len(), 3);
        assert_eq!(c.elapsed.len(), 3);
        assert_eq!(c.obj_hash.len(), 3);
        assert_eq!(c.service.len(), 3);
        assert_eq!(c.error.len(), 3);
        assert_eq!(c.x_type.len(), 3);
        assert_eq!(c.cpu.len(), 3);
        assert_eq!(c.sql_count.len(), 3);
        assert_eq!(c.sql_time.len(), 3);
        assert_eq!(c.apicall_count.len(), 3);
        assert_eq!(c.apicall_time.len(), 3);
        assert_eq!(c.ipaddr.len(), 3);
        assert_eq!(c.kbytes.len(), 3);
        assert_eq!(c.thread_name_hash.len(), 3);
    }

    #[test]
    fn 순서가_그대로다() {
        // 열끼리 어긋나면 다른 트랜잭션의 값이 섞인다 — 화면에서 알아챌 방법이 없다.
        let c = XLogColumns::from(vec![pack(1, 10), pack(2, 20), pack(3, 30)]);
        assert_eq!(c.txid, vec!["1", "2", "3"]);
        assert_eq!(c.elapsed, vec![10, 20, 30]);
        assert_eq!(c.end_time[2] - c.end_time[0], 2);
    }

    #[test]
    fn 큰_txid_는_문자열로_간다() {
        // JS 의 number 로는 i64 를 정확히 담지 못한다
        let c = XLogColumns::from(vec![pack(-4426811361927716372, 1)]);
        assert_eq!(c.txid[0], "-4426811361927716372");
    }

    #[test]
    fn 빈_묶음도_다룬다() {
        let c = XLogColumns::from(Vec::new());
        assert!(c.is_empty());
        assert_eq!(c.len(), 0);
    }
}
