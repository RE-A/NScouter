// 오브젝트 단건 명령 (OBJECT_*) 요청/응답 처리
//
// 콜렉터가 에이전트로 중계하는 명령들이다. 응답은 전부 MapPack 으로 온다
// (실측: `probe_object_mappack_keys`).
//
// 파라미터 키는 `objHash` 하나다. 틀리면 에러 없이 NoNEXT 가 와서
// 빈 결과가 된다 — 이 프로토콜의 실패 방식이다 (F-15).

use serde::Serialize;

use super::pack::MapPack;
use super::value::ScouterValue;

/// `objHash` 하나만 담는 공통 파라미터.
pub fn build_object_param(obj_hash: i32) -> MapPack {
    let mut param = MapPack::new();
    param.put("objHash", ScouterValue::Decimal(obj_hash as i64));
    param
}

// ─── OBJECT_ENV ──────────────────────────────────────────────

/// 에이전트 JVM 의 시스템 프로퍼티 한 줄.
#[derive(Debug, Clone, Serialize)]
pub struct EnvEntry {
    pub key: String,
    pub value: String,
}

/// 응답은 평평한 key→Text MapPack 이다.
///
/// **키 순서를 보장하지 않는다** (HashMap). 화면에서 정렬해 쓰라고
/// 여기서 이름순으로 맞춰 둔다 — 매 폴링마다 순서가 바뀌면 못 읽는다.
pub fn parse_object_env(out: &MapPack) -> Vec<EnvEntry> {
    let mut list: Vec<EnvEntry> = out
        .entries
        .iter()
        .filter_map(|(k, v)| {
            Some(EnvEntry {
                key: k.clone(),
                value: v.as_text()?.to_string(),
            })
        })
        .collect();
    list.sort_by(|a, b| a.key.cmp(&b.key));
    list
}

// ─── OBJECT_THREAD_LIST ──────────────────────────────────────

/// 에이전트 JVM 의 스레드 한 개.
///
/// 트랜잭션을 처리 중인 스레드만 `service`/`txid`/`elapsed` 가 채워진다.
/// 유휴 스레드는 그 자리에 Null 이 온다 (실측).
#[derive(Debug, Clone, Serialize)]
pub struct ThreadInfo {
    pub id: i64,
    pub name: String,
    /// RUNNABLE / WAITING / TIMED_WAITING / BLOCKED
    pub stat: String,
    /// 누적 CPU 시간(ms)
    pub cpu: i64,
    /// 처리 중인 트랜잭션의 경과 시간(ms). 유휴면 None
    pub elapsed: Option<i64>,
    /// 서비스명 해시. 유휴면 None
    pub service: Option<i32>,
    #[serde(serialize_with = "super::pack::serialize_opt_i64_as_string")]
    pub txid: Option<i64>,
}

/// 응답은 7개 **병렬 리스트**다 (`id` `name` `stat` `cpu` `elapsed` `service` `txid`).
///
/// 길이가 어긋나면 짧은 쪽에 맞춘다 — 인덱스가 밀리면 엉뚱한 스레드에
/// 남의 트랜잭션이 붙는다.
pub fn parse_thread_list(out: &MapPack) -> Vec<ThreadInfo> {
    let list = |key: &str| match out.entries.get(key) {
        Some(ScouterValue::List(v)) => v.as_slice(),
        _ => &[][..],
    };

    let ids = list("id");
    let names = list("name");
    let stats = list("stat");
    let cpus = list("cpu");
    let elapsed = list("elapsed");
    let services = list("service");
    let txids = list("txid");

    let n = ids.len().min(names.len());
    (0..n)
        .map(|i| ThreadInfo {
            id: ids[i].as_decimal().unwrap_or(0),
            name: names[i].as_text().unwrap_or("").to_string(),
            stat: stats.get(i).and_then(|v| v.as_text()).unwrap_or("").to_string(),
            cpu: cpus.get(i).and_then(|v| v.as_decimal()).unwrap_or(0),
            elapsed: elapsed.get(i).and_then(|v| v.as_decimal()),
            service: services.get(i).and_then(|v| v.as_decimal()).map(|v| v as i32),
            txid: txids.get(i).and_then(|v| v.as_decimal()),
        })
        .collect()
}

// ─── SOCKET ──────────────────────────────────────────────────

/// 에이전트가 열고 있는 소켓 하나.
///
/// `service`/`txid` 가 채워져 있으면 **그 트랜잭션이 연 소켓**이다.
/// 0 이면 트랜잭션과 무관한 상시 연결(콜렉터, 커넥션 풀 등)이다.
#[derive(Debug, Clone, Serialize)]
pub struct SocketInfo {
    /// 소켓 식별자. i64 라 문자열로 보낸다
    #[serde(serialize_with = "super::pack::serialize_i64_as_string")]
    pub key: i64,
    /// 상대 IP. 응답은 **Blob 4바이트**라 문자열로 바꿔 보낸다
    pub host: String,
    pub port: i32,
    /// 같은 상대로 열린 소켓 수
    pub count: i64,
    pub service: Option<i32>,
    #[serde(serialize_with = "super::pack::serialize_opt_i64_as_string")]
    pub txid: Option<i64>,
    pub stack: String,
}

/// 응답은 8개 병렬 리스트다 (`key` `host` `port` `count` `service` `txid` `order` `stack`).
pub fn parse_socket_list(out: &MapPack) -> Vec<SocketInfo> {
    let list = |key: &str| match out.entries.get(key) {
        Some(ScouterValue::List(v)) => v.as_slice(),
        _ => &[][..],
    };

    let keys = list("key");
    let hosts = list("host");
    let ports = list("port");
    let counts = list("count");
    let services = list("service");
    let txids = list("txid");
    let stacks = list("stack");

    let n = keys.len().min(hosts.len());
    (0..n)
        .map(|i| SocketInfo {
            key: keys[i].as_decimal().unwrap_or(0),
            host: match &hosts[i] {
                ScouterValue::Blob(b) => super::pack::bytes_to_ip(b),
                v => v.as_text().unwrap_or("").to_string(),
            },
            port: ports.get(i).and_then(|v| v.as_decimal()).unwrap_or(0) as i32,
            count: counts.get(i).and_then(|v| v.as_decimal()).unwrap_or(0),
            // 0 은 "없음" 이다. 그대로 두면 해시 0 을 조회하러 간다.
            service: services
                .get(i)
                .and_then(|v| v.as_decimal())
                .filter(|v| *v != 0)
                .map(|v| v as i32),
            txid: txids.get(i).and_then(|v| v.as_decimal()).filter(|v| *v != 0),
            stack: stacks.get(i).and_then(|v| v.as_text()).unwrap_or("").to_string(),
        })
        .collect()
}

// ─── OBJECT_CLASS_LIST ───────────────────────────────────────

/// 로드된 클래스 하나.
#[derive(Debug, Clone, Serialize)]
pub struct LoadedClass {
    pub index: i64,
    pub name: String,
    pub super_class: String,
    pub interfaces: String,
    /// 어느 파일에서 왔는지. 같은 이름 클래스가 여러 jar 에 있을 때 이게 답이다
    pub resource: String,
}

/// 클래스 목록 한 페이지.
///
/// **이 응답만 페이지 단위다.** 총 17,000개가 넘어 한 번에 오지 않는다.
#[derive(Debug, Clone, Serialize)]
pub struct ClassListPage {
    pub page: i32,
    pub total_page: i32,
    pub classes: Vec<LoadedClass>,
}

/// `page`/`totalPage` 는 **스칼라**고 나머지가 병렬 리스트다.
pub fn parse_class_list(out: &MapPack) -> ClassListPage {
    let list = |key: &str| match out.entries.get(key) {
        Some(ScouterValue::List(v)) => v.as_slice(),
        _ => &[][..],
    };

    let index = list("index");
    let names = list("name");
    let supers = list("superClass");
    let ifaces = list("interfaces");
    let resources = list("resource");

    let n = index.len().min(names.len());
    let classes = (0..n)
        .map(|i| LoadedClass {
            index: index[i].as_decimal().unwrap_or(0),
            name: names[i].as_text().unwrap_or("").to_string(),
            super_class: supers.get(i).and_then(|v| v.as_text()).unwrap_or("").to_string(),
            interfaces: ifaces.get(i).and_then(|v| v.as_text()).unwrap_or("").to_string(),
            resource: resources.get(i).and_then(|v| v.as_text()).unwrap_or("").to_string(),
        })
        .collect();

    ClassListPage {
        page: out.get_decimal("page").unwrap_or(1) as i32,
        total_page: out.get_decimal("totalPage").unwrap_or(1) as i32,
        classes,
    }
}

/// 클래스 목록은 페이지 파라미터가 하나 더 붙는다.
pub fn build_class_list_param(obj_hash: i32, page: i32) -> MapPack {
    let mut param = build_object_param(obj_hash);
    param.put("page", ScouterValue::Decimal(page as i64));
    param
}

// ─── OBJECT_ACTIVE_SERVICE_LIST ──────────────────────────────

/// 지금 이 순간 돌고 있는 트랜잭션 하나.
///
/// 스레드 목록과 겹쳐 보이지만 **여기는 서비스명이 이미 텍스트**다 —
/// 해시를 사전에서 찾을 필요가 없다. 대신 `txid` 가 Hexa32 문자열로 온다 (F-21).
#[derive(Debug, Clone, Serialize)]
pub struct ActiveService {
    /// 어느 오브젝트의 것인가.
    ///
    /// **타입 전체 조회에서는 이게 없으면 행이 뒤섞여 무의미해진다** —
    /// 어느 서버가 막혔는지가 곧 알고 싶은 것이다.
    pub obj_hash: i32,
    /// 스레드 ID
    pub id: i64,
    /// 스레드 이름
    pub name: String,
    /// 서비스명. **해시가 아니라 텍스트다**
    pub service: String,
    pub stat: String,
    pub elapsed: i64,
    pub cpu: i64,
    pub ip: String,
    pub login: String,
    /// 실행 중인 SQL (없으면 빈 문자열)
    pub sql: String,
    /// 호출 중인 외부 API (없으면 빈 문자열)
    pub subcall: String,
    /// Hexa32 로 오는 걸 i64 로 풀어 문자열로 보낸다 —
    /// XLog 의 txid 와 같은 표기여야 나중에 트랜잭션을 이어 볼 수 있다.
    #[serde(serialize_with = "super::pack::serialize_opt_i64_as_string")]
    pub txid: Option<i64>,
}

/// 응답은 병렬 리스트다. 키가 빠질 수 있으므로 없는 건 기본값으로 둔다.
pub fn parse_active_services(out: &MapPack) -> Vec<ActiveService> {
    let list = |key: &str| match out.entries.get(key) {
        Some(ScouterValue::List(v)) => v.as_slice(),
        _ => &[][..],
    };
    let text_at = |items: &[ScouterValue], i: usize| {
        items.get(i).and_then(|v| v.as_text()).unwrap_or("").to_string()
    };
    let num_at = |items: &[ScouterValue], i: usize| {
        items.get(i).and_then(|v| v.as_decimal()).unwrap_or(0)
    };

    let ids = list("id");
    let names = list("name");
    let services = list("service");
    let stats = list("stat");
    let elapsed = list("elapsed");
    let cpus = list("cpu");
    let ips = list("ip");
    let logins = list("login");
    let sqls = list("sql");
    let subcalls = list("subcall");
    let txids = list("txid");

    // 응답 pack 자체가 어느 오브젝트인지 들고 있다 (리스트가 아니라 스칼라다).
    let obj_hash = out.get_decimal("objHash").unwrap_or(0) as i32;

    let n = ids.len().max(services.len());
    (0..n)
        .map(|i| ActiveService {
            obj_hash,
            id: num_at(ids, i),
            name: text_at(names, i),
            service: text_at(services, i),
            stat: text_at(stats, i),
            elapsed: num_at(elapsed, i),
            cpu: num_at(cpus, i),
            ip: text_at(ips, i),
            login: text_at(logins, i),
            sql: text_at(sqls, i),
            subcall: text_at(subcalls, i),
            txid: txids
                .get(i)
                .and_then(|v| v.as_text())
                .and_then(super::dictionary::hexa32_to_i64)
                .filter(|v| *v != 0),
        })
        .collect()
}

// ─── OBJECT_HEAPHISTO ────────────────────────────────────────

/// 힙 히스토그램 한 줄 — 클래스별 인스턴스 수와 점유 바이트.
#[derive(Debug, Clone, Serialize)]
pub struct HeapHistoRow {
    pub rank: i32,
    pub instances: i64,
    pub bytes: i64,
    pub class_name: String,
}

/// 응답은 `heaphisto` → **이미 서식이 잡힌 텍스트 줄 목록**이다.
///
/// ```text
///    2:        238522        5724528  java.lang.String (java.base@17.0.19)
/// ```
///
/// 그대로 뿌리면 "무엇이 메모리를 먹는가" 로 정렬할 수 없다. 열로 나눈다.
/// 머리글·구분선·Total 줄은 형식이 달라 자연히 걸러진다.
pub fn parse_heap_histogram(out: &MapPack) -> Vec<HeapHistoRow> {
    let Some(ScouterValue::List(lines)) = out.entries.get("heaphisto") else {
        return Vec::new();
    };

    lines
        .iter()
        .filter_map(|v| parse_histo_line(v.as_text()?))
        .collect()
}

fn parse_histo_line(line: &str) -> Option<HeapHistoRow> {
    let mut it = line.split_whitespace();

    // 첫 토큰은 "2:" 처럼 콜론으로 끝난다. 아니면 머리글이나 Total 줄이다.
    let rank = it.next()?.strip_suffix(':')?.parse::<i32>().ok()?;
    let instances = it.next()?.parse::<i64>().ok()?;
    let bytes = it.next()?.parse::<i64>().ok()?;
    // 클래스명 뒤에 모듈 표기가 붙는다: `java.lang.String (java.base@17.0.19)`
    let class_name = it.collect::<Vec<_>>().join(" ");
    if class_name.is_empty() {
        return None;
    }

    Some(HeapHistoRow { rank, instances, bytes, class_name })
}

// ─── 덤프 파일 ───────────────────────────────────────────────

/// 에이전트가 만들어 둔 덤프 파일 하나.
#[derive(Debug, Clone, Serialize)]
pub struct DumpFile {
    pub name: String,
    pub size: i64,
    /// epoch ms
    pub last_modified: i64,
}

/// `OBJECT_DUMP_FILE_LIST` 응답 — `name`/`size`/`last_modified` 병렬 리스트.
///
/// **최신 파일부터** 돌려준다. 방금 만든 덤프를 찾으러 목록을 열기 때문이다.
pub fn parse_dump_file_list(out: &MapPack) -> Vec<DumpFile> {
    let list = |key: &str| match out.entries.get(key) {
        Some(ScouterValue::List(v)) => v.as_slice(),
        _ => &[][..],
    };

    let names = list("name");
    let sizes = list("size");
    let times = list("last_modified");

    let mut files: Vec<DumpFile> = (0..names.len())
        .filter_map(|i| {
            Some(DumpFile {
                name: names[i].as_text()?.to_string(),
                size: sizes.get(i).and_then(|v| v.as_decimal()).unwrap_or(0),
                last_modified: times.get(i).and_then(|v| v.as_decimal()).unwrap_or(0),
            })
        })
        .collect();
    files.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    files
}

/// 덤프 파일 내용 요청 파라미터. 파일 이름 키는 **`name`** 이다 (`file` 은 빈 응답).
pub fn build_dump_file_param(obj_hash: i32, name: &str) -> MapPack {
    let mut param = build_object_param(obj_hash);
    param.put("name", ScouterValue::Text(name.to_string()));
    param
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(items: &[&str]) -> ScouterValue {
        ScouterValue::List(items.iter().map(|s| ScouterValue::Text(s.to_string())).collect())
    }

    fn decimals(items: &[i64]) -> ScouterValue {
        ScouterValue::List(items.iter().map(|v| ScouterValue::Decimal(*v)).collect())
    }

    #[test]
    fn 파라미터는_objhash_하나다() {
        let p = build_object_param(-1585387669);
        assert_eq!(p.get_decimal("objHash"), Some(-1585387669));
        assert_eq!(p.entries.len(), 1);
    }

    #[test]
    fn env_는_이름순으로_정렬된다() {
        // HashMap 이라 넣은 순서와 무관하게 나온다.
        // 매 폴링마다 순서가 바뀌면 화면이 흔들려 못 읽는다.
        let mut m = MapPack::new();
        m.put("os.name", ScouterValue::Text("Linux".into()));
        m.put("java.version", ScouterValue::Text("17".into()));
        m.put("user.dir", ScouterValue::Text("/app".into()));

        let env = parse_object_env(&m);
        let keys: Vec<&str> = env.iter().map(|e| e.key.as_str()).collect();
        assert_eq!(keys, ["java.version", "os.name", "user.dir"]);
    }

    #[test]
    fn env_는_텍스트가_아닌_값을_버린다() {
        let mut m = MapPack::new();
        m.put("ok", ScouterValue::Text("v".into()));
        m.put("num", ScouterValue::Decimal(1));
        assert_eq!(parse_object_env(&m).len(), 1);
    }

    #[test]
    fn 스레드_목록을_병렬_리스트에서_뽑는다() {
        let mut m = MapPack::new();
        m.put("id", decimals(&[2, 3]));
        m.put("name", texts(&["Reference Handler", "Finalizer"]));
        m.put("stat", texts(&["RUNNABLE", "WAITING"]));
        m.put("cpu", decimals(&[78, 17]));

        let list = parse_thread_list(&m);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, 2);
        assert_eq!(list[0].name, "Reference Handler");
        assert_eq!(list[0].stat, "RUNNABLE");
        assert_eq!(list[1].cpu, 17);
    }

    #[test]
    fn 유휴_스레드는_트랜잭션_필드가_비어_있다() {
        let mut m = MapPack::new();
        m.put("id", decimals(&[2]));
        m.put("name", texts(&["Reference Handler"]));
        m.put(
            "elapsed",
            ScouterValue::List(vec![ScouterValue::Null]),
        );
        m.put("service", ScouterValue::List(vec![ScouterValue::Null]));
        m.put("txid", ScouterValue::List(vec![ScouterValue::Null]));

        let t = &parse_thread_list(&m)[0];
        assert_eq!(t.elapsed, None);
        assert_eq!(t.service, None);
        assert_eq!(t.txid, None);
    }

    #[test]
    fn 처리중인_스레드는_트랜잭션_필드가_채워진다() {
        let mut m = MapPack::new();
        m.put("id", decimals(&[41]));
        m.put("name", texts(&["http-nio-8081-exec-1"]));
        m.put("elapsed", decimals(&[3011]));
        m.put("service", decimals(&[-1479939665]));
        m.put("txid", decimals(&[6131744867290333150]));

        let t = &parse_thread_list(&m)[0];
        assert_eq!(t.elapsed, Some(3011));
        assert_eq!(t.service, Some(-1479939665));
        assert_eq!(t.txid, Some(6131744867290333150));
    }

    // 길이가 어긋난 채 인덱스로 접근하면 엉뚱한 스레드에 남의 트랜잭션이 붙는다.
    #[test]
    fn 리스트_길이가_어긋나면_짧은_쪽에_맞춘다() {
        let mut m = MapPack::new();
        m.put("id", decimals(&[1, 2, 3]));
        m.put("name", texts(&["a"]));
        assert_eq!(parse_thread_list(&m).len(), 1);
    }

    #[test]
    fn 빈_응답은_빈_목록이다() {
        assert!(parse_thread_list(&MapPack::new()).is_empty());
        assert!(parse_object_env(&MapPack::new()).is_empty());
        assert!(parse_socket_list(&MapPack::new()).is_empty());
        assert!(parse_class_list(&MapPack::new()).classes.is_empty());
    }

    // ─── SOCKET ──────────────────────────────────────────────

    #[test]
    fn 소켓의_host_는_blob_4바이트라_ip_로_바꾼다() {
        let mut m = MapPack::new();
        m.put("key", decimals(&[745629425214691284]));
        m.put(
            "host",
            ScouterValue::List(vec![ScouterValue::Blob(vec![10, 89, 2, 3])]),
        );
        m.put("port", decimals(&[6100]));
        m.put("count", decimals(&[1]));

        let s = &parse_socket_list(&m)[0];
        assert_eq!(s.host, "10.89.2.3");
        assert_eq!(s.port, 6100);
        assert_eq!(s.count, 1);
        assert_eq!(s.key, 745629425214691284);
    }

    // 상시 연결(콜렉터/커넥션 풀)은 service/txid 가 0 으로 온다.
    // 그대로 두면 해시 0 을 사전에서 조회하러 간다.
    #[test]
    fn 소켓의_service_txid_0_은_없음이다() {
        let mut m = MapPack::new();
        m.put("key", decimals(&[1]));
        m.put("host", ScouterValue::List(vec![ScouterValue::Blob(vec![127, 0, 0, 1])]));
        m.put("service", decimals(&[0]));
        m.put("txid", decimals(&[0]));

        let s = &parse_socket_list(&m)[0];
        assert_eq!(s.service, None);
        assert_eq!(s.txid, None);
    }

    #[test]
    fn 소켓이_트랜잭션에_속하면_값이_남는다() {
        let mut m = MapPack::new();
        m.put("key", decimals(&[1]));
        m.put("host", ScouterValue::List(vec![ScouterValue::Blob(vec![10, 0, 0, 5])]));
        m.put("service", decimals(&[-1479939665]));
        m.put("txid", decimals(&[6131744867290333150]));

        let s = &parse_socket_list(&m)[0];
        assert_eq!(s.service, Some(-1479939665));
        assert_eq!(s.txid, Some(6131744867290333150));
    }

    // ─── OBJECT_CLASS_LIST ───────────────────────────────────

    #[test]
    fn 클래스_목록은_page_와_totalpage_가_스칼라다() {
        let mut m = MapPack::new();
        m.put("page", ScouterValue::Decimal(3));
        m.put("totalPage", ScouterValue::Decimal(171));
        m.put("index", decimals(&[1, 2]));
        m.put("name", texts(&["java.lang.String", "java.util.List"]));
        m.put("superClass", texts(&["java.lang.Object", ""]));
        m.put("interfaces", texts(&["", ""]));
        m.put("resource", texts(&["jrt:/java.base", ""]));

        let p = parse_class_list(&m);
        assert_eq!(p.page, 3);
        assert_eq!(p.total_page, 171);
        assert_eq!(p.classes.len(), 2);
        assert_eq!(p.classes[0].name, "java.lang.String");
        assert_eq!(p.classes[0].resource, "jrt:/java.base");
    }

    // page 가 없으면 1페이지로 본다 — 0 이면 요청이 헛돈다.
    #[test]
    fn 클래스_목록에_page_가_없으면_1_이다() {
        let p = parse_class_list(&MapPack::new());
        assert_eq!(p.page, 1);
        assert_eq!(p.total_page, 1);
    }

    // ─── OBJECT_ACTIVE_SERVICE_LIST ──────────────────────────

    // 스레드 목록과 달리 서비스명이 **텍스트**로 온다. 사전 조회가 필요 없다.
    #[test]
    fn 활성_서비스는_서비스명이_텍스트다() {
        let mut m = MapPack::new();
        m.put("id", decimals(&[41]));
        m.put("name", texts(&["http-nio-8081-exec-9"]));
        m.put("service", texts(&["/shop/lab/slow<GET>"]));
        m.put("stat", texts(&["TIMED_WAITING"]));
        m.put("elapsed", decimals(&[3011]));

        let a = &parse_active_services(&m)[0];
        assert_eq!(a.service, "/shop/lab/slow<GET>");
        assert_eq!(a.name, "http-nio-8081-exec-9");
        assert_eq!(a.elapsed, 3011);
    }

    // txid 는 Hexa32 문자열로 온다 (F-21). 10진수로 파싱하면 전부 실패한다.
    #[test]
    fn 활성_서비스의_txid_는_hexa32_다() {
        let mut m = MapPack::new();
        m.put("id", decimals(&[1]));
        m.put("txid", texts(&["x1jrf6b3"]));

        let a = &parse_active_services(&m)[0];
        assert_eq!(a.txid, Some(i64::from_str_radix("1jrf6b3", 32).unwrap()));
    }

    #[test]
    fn 활성_서비스의_txid_가_없으면_none_이다() {
        let mut m = MapPack::new();
        m.put("id", decimals(&[1]));
        m.put("txid", texts(&[""]));
        assert_eq!(parse_active_services(&m)[0].txid, None);
    }

    // 키가 통째로 빠져도 죽으면 안 된다 — 활성 트랜잭션이 없을 때 빈 리스트만 온다.
    #[test]
    fn 활성_서비스는_없는_키를_기본값으로_채운다() {
        let mut m = MapPack::new();
        m.put("service", texts(&["/a", "/b"]));

        let list = parse_active_services(&m);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].service, "/a");
        assert_eq!(list[0].id, 0);
        assert_eq!(list[0].sql, "");
    }

    // ─── 힙 히스토그램 ───────────────────────────────────────

    fn histo(lines: &[&str]) -> MapPack {
        let mut m = MapPack::new();
        m.put("heaphisto", texts(lines));
        m
    }

    #[test]
    fn 히스토그램_줄을_열로_나눈다() {
        let m = histo(&["   2:        238522        5724528  java.lang.String (java.base@17.0.19)"]);
        let r = &parse_heap_histogram(&m)[0];
        assert_eq!(r.rank, 2);
        assert_eq!(r.instances, 238522);
        assert_eq!(r.bytes, 5724528);
        assert_eq!(r.class_name, "java.lang.String (java.base@17.0.19)");
    }

    // 배열 표기(`[Ljava.lang.Object;`)도 클래스명이다.
    #[test]
    fn 배열_클래스명도_읽는다() {
        let m = histo(&["   3:        100749        4351720  [Ljava.lang.Object; (java.base@17.0.19)"]);
        assert_eq!(parse_heap_histogram(&m)[0].class_name, "[Ljava.lang.Object; (java.base@17.0.19)");
    }

    // 머리글·구분선·Total 은 형식이 달라 자연히 걸러져야 한다.
    // 이게 안 되면 목록 맨 위에 rank=0 짜리 쓰레기 행이 낀다.
    #[test]
    fn 머리글과_합계_줄은_버린다() {
        let m = histo(&[
            " num     #instances         #bytes  class name (module)",
            "-------------------------------------------------------",
            "   1:        400000       12000000  java.lang.Object",
            "Total       1234567       89012345",
        ]);
        let rows = parse_heap_histogram(&m);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].rank, 1);
    }

    #[test]
    fn 히스토그램이_없으면_빈_목록이다() {
        assert!(parse_heap_histogram(&MapPack::new()).is_empty());
    }

    // ─── 덤프 파일 ───────────────────────────────────────────

    // 방금 만든 덤프를 찾으러 목록을 여는 것이므로 최신이 위에 있어야 한다.
    #[test]
    fn 덤프_목록은_최신순이다() {
        let mut m = MapPack::new();
        m.put("name", texts(&["old.dump", "new.dump", "mid.dump"]));
        m.put("size", decimals(&[100, 300, 200]));
        m.put("last_modified", decimals(&[1000, 3000, 2000]));

        let files = parse_dump_file_list(&m);
        let names: Vec<&str> = files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["new.dump", "mid.dump", "old.dump"]);
        assert_eq!(files[0].size, 300);
    }

    // 파일 이름 키는 `name` 이다. `file` 로 보내면 빈 응답이 온다 (실측).
    #[test]
    fn 덤프_내용_파라미터는_name_이다() {
        let p = build_dump_file_param(-1585387669, "scouter.threaddump.x.dump");
        assert_eq!(p.get_decimal("objHash"), Some(-1585387669));
        assert_eq!(p.get_text("name"), Some("scouter.threaddump.x.dump"));
    }

    #[test]
    fn 클래스_목록_파라미터에_page_가_붙는다() {
        let p = build_class_list_param(-1585387669, 7);
        assert_eq!(p.get_decimal("objHash"), Some(-1585387669));
        assert_eq!(p.get_decimal("page"), Some(7));
    }
}

// ─── 부수효과가 있는 명령 ─────────────────────────────────────

/// 힙 덤프 요청.
///
/// **`objHash` 만 보내면 조용히 빈 응답이 온다** (F-35). ASIS `HeapDumpAction` 은
/// `fName`(파일명 접두)과 `time`(요청 시각)을 함께 보낸다. 셋이 다 있어야
/// `{success, msg}` 가 돌아온다.
pub fn build_heap_dump_param(obj_hash: i32, f_name: &str, time: i64) -> MapPack {
    let mut param = build_object_param(obj_hash);
    param.put("fName", ScouterValue::Text(f_name.to_string()));
    param.put("time", ScouterValue::Decimal(time));
    param
}

/// 스택 샘플링 켜기/끄기.
///
/// 같은 명령(`PSTACK_ON`)으로 둘 다 한다 — **`time` 이 있으면 켜기**, 없으면 끄기다
/// (ASIS TurnOnStackAction / TurnOffStackAction).
pub fn build_pstack_param(obj_hash: i32, duration_ms: Option<i64>) -> MapPack {
    let mut param = build_object_param(obj_hash);
    if let Some(ms) = duration_ms {
        param.put("time", ScouterValue::Decimal(ms));
    }
    param
}

/// 실행 중인 트랜잭션 한 건의 상세.
///
/// 목록이 "무엇이 몇 초째 돌고 있다"까지라면, 이건 **지금 어디에 멈춰 있나**다.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ThreadDetail {
    pub thread_id: i64,
    pub thread_name: String,
    /// RUNNABLE / TIMED_WAITING / BLOCKED …
    pub state: String,
    pub service_name: String,
    /// Hexa32 표기 그대로 온다 (`x2hgqrvc7simcd`)
    pub service_txid: String,
    pub service_elapsed: i64,
    /// 누적 CPU 시간(ms)
    pub cpu_time: i64,
    pub user_time: i64,
    pub blocked_count: i64,
    /// **-1 은 0이 아니라 "측정 꺼짐"이다** (JMX 스레드 경합 측정 미사용, F-46)
    pub blocked_time: Option<i64>,
    pub waited_count: i64,
    /// -1 이면 측정 꺼짐
    pub waited_time: Option<i64>,
    pub lock_name: String,
    pub lock_owner_id: Option<i64>,
    pub lock_owner_name: String,
    /// 실행 중인 SQL. 없으면 빈 문자열
    pub sql: String,
    /// SQL 바인드 변수
    pub sql_bind_var: String,
    /// 호출 중인 외부 API
    pub subcall: String,
    /// **이걸 보려고 여는 화면이다**
    pub stack_trace: String,
}

/// 응답 MapPack 을 읽는다.
///
/// **키가 사람이 읽는 이름이다** — `"Service Name"`, `"Stack Trace"` 처럼 공백이 든다
/// (실측 확인, ASIS webapp `ActiveThread.of` 와 같다). camelCase 로 짐작하면 전부 빈다.
///
/// 없는 키는 빈 값으로 둔다 — SQL 을 안 돌리는 스레드에는 `SQL` 키 자체가 없다.
pub fn parse_thread_detail(map: &MapPack) -> ThreadDetail {
    let text = |k: &str| map.get_text(k).unwrap_or("").to_string();
    let num = |k: &str| map.entries.get(k).and_then(|v| v.as_number()).unwrap_or(0.0) as i64;
    // -1 은 "안 잼"이다. 0으로 눕히면 "경합이 전혀 없었다"는 거짓이 된다.
    let measured = |k: &str| match map.entries.get(k).and_then(|v| v.as_number()) {
        Some(v) if v >= 0.0 => Some(v as i64),
        _ => None,
    };

    ThreadDetail {
        thread_id: num("Thread Id"),
        thread_name: text("Thread Name"),
        state: text("State"),
        service_name: text("Service Name"),
        service_txid: text("Service Txid"),
        service_elapsed: num("Service Elapsed"),
        cpu_time: num("Thread Cpu Time"),
        user_time: num("Thread User Time"),
        blocked_count: num("Blocked Count"),
        blocked_time: measured("Blocked Time"),
        waited_count: num("Waited Count"),
        waited_time: measured("Waited Time"),
        lock_name: text("Lock Name"),
        lock_owner_id: measured("Lock Owner Id"),
        lock_owner_name: text("Lock Owner Name"),
        sql: text("SQL"),
        sql_bind_var: text("SQLActiveBindVar"),
        subcall: text("Subcall"),
        stack_trace: text("Stack Trace"),
    }
}

/// `OBJECT_THREAD_DETAIL` 파라미터.
///
/// **셋 다 있어야 한다** (ASIS `AgentDataProxy.getThreadDetail`).
/// 스레드 id 만으로는 부족하다 — 같은 스레드가 다음 트랜잭션을 이미 잡았을 수 있어서
/// txid 로 "그 트랜잭션이 아직 그 스레드에 있는가"를 함께 묻는다.
pub fn build_thread_detail_param(obj_hash: i32, thread_id: i64, txid: i64) -> MapPack {
    let mut param = build_object_param(obj_hash);
    param.put("id", ScouterValue::Decimal(thread_id));
    param.put("txid", ScouterValue::Decimal(txid));
    param
}

#[cfg(test)]
mod thread_detail_param_tests {
    use super::*;

    fn detail_map() -> MapPack {
        // 실측 응답 그대로의 키다 (probe_thread_detail).
        let mut m = MapPack::new();
        m.put("Thread Id", ScouterValue::Decimal(43));
        m.put("Thread Name", ScouterValue::Text("http-nio-8081-exec-8".into()));
        m.put("State", ScouterValue::Text("TIMED_WAITING".into()));
        m.put("Service Name", ScouterValue::Text("/shop/lab/jitter<GET>".into()));
        m.put("Service Txid", ScouterValue::Text("x2hgqrvc7simcd".into()));
        m.put("Service Elapsed", ScouterValue::Decimal(1012));
        m.put("Thread Cpu Time", ScouterValue::Decimal(4276));
        m.put("Thread User Time", ScouterValue::Decimal(3610));
        m.put("Blocked Count", ScouterValue::Decimal(23));
        m.put("Blocked Time", ScouterValue::Decimal(-1));
        m.put("Waited Count", ScouterValue::Decimal(2131));
        m.put("Waited Time", ScouterValue::Decimal(-1));
        m.put("Lock Owner Id", ScouterValue::Decimal(-1));
        m.put("Lock Name", ScouterValue::Text(String::new()));
        m.put("Lock Owner Name", ScouterValue::Text(String::new()));
        m.put("Stack Trace", ScouterValue::Text("java.lang.Thread.sleep(Native Method)".into()));
        m
    }

    #[test]
    fn reads_keys_with_spaces() {
        // camelCase 로 짐작하면 전부 빈다 — 키에 공백이 있다.
        let d = parse_thread_detail(&detail_map());
        assert_eq!(d.thread_name, "http-nio-8081-exec-8");
        assert_eq!(d.service_name, "/shop/lab/jitter<GET>");
        assert_eq!(d.service_elapsed, 1012);
        assert!(d.stack_trace.contains("Thread.sleep"));
    }

    #[test]
    fn minus_one_is_not_measured_not_zero() {
        // -1 을 0으로 눕히면 "경합이 전혀 없었다"는 거짓이 된다.
        let d = parse_thread_detail(&detail_map());
        assert_eq!(d.blocked_time, None);
        assert_eq!(d.waited_time, None);
        assert_eq!(d.lock_owner_id, None);
        // 횟수는 실제 값이다 — 시간만 측정이 꺼져 있다.
        assert_eq!(d.blocked_count, 23);
        assert_eq!(d.waited_count, 2131);
    }

    #[test]
    fn missing_optional_keys_are_empty_not_error() {
        // SQL 을 안 돌리는 스레드에는 SQL 키 자체가 없다.
        let d = parse_thread_detail(&detail_map());
        assert_eq!(d.sql, "");
        assert_eq!(d.subcall, "");
        assert_eq!(d.sql_bind_var, "");
    }

    #[test]
    fn empty_map_does_not_panic() {
        let d = parse_thread_detail(&MapPack::new());
        assert_eq!(d.thread_id, 0);
        assert_eq!(d.stack_trace, "");
    }

    #[test]
    fn thread_detail_needs_all_three() {
        // 하나라도 빠지면 에러가 아니라 빈 응답이 온다 (F-15).
        let p = build_thread_detail_param(-1585387669, 42, 1234567890);
        assert_eq!(p.get_decimal("objHash"), Some(-1585387669));
        assert_eq!(p.get_decimal("id"), Some(42));
        assert_eq!(p.get_decimal("txid"), Some(1234567890));
    }
}

// ─── 모인 스택 조회 ──────────────────────────────────────────

/// `GET_STACK_INDEX` / `GET_STACK_ANALYZER` 파라미터.
///
/// **objHash 가 아니라 `objName` 이다.** 다른 OBJECT_* 명령과 키가 다르므로
/// 습관대로 objHash 를 넣으면 에러 없이 0건이 온다 (F-15).
pub fn build_stack_range_param(obj_name: &str, from: i64, to: i64) -> MapPack {
    let mut param = MapPack::new();
    param.put("objName", ScouterValue::Text(obj_name.to_string()));
    param.put("from", ScouterValue::Decimal(from));
    param.put("to", ScouterValue::Decimal(to));
    param
}

#[cfg(test)]
mod stack_range_tests {
    use super::*;

    #[test]
    fn stack_param_uses_objname_not_objhash() {
        // 다른 OBJECT_* 는 objHash 인데 이것만 objName 이다.
        let p = build_stack_range_param("/shop-app/shop-app", 100, 200);
        assert_eq!(p.get_text("objName"), Some("/shop-app/shop-app"));
        assert!(p.entries.get("objHash").is_none());
        assert_eq!(p.get_decimal("from"), Some(100));
        assert_eq!(p.get_decimal("to"), Some(200));
    }
}

#[cfg(test)]
mod side_effect_tests {
    use super::*;

    #[test]
    fn heap_dump_needs_all_three() {
        let p = build_heap_dump_param(-1585387669, "-1585387669", 1_700_000_000_000);
        assert_eq!(p.get_decimal("objHash"), Some(-1585387669));
        assert_eq!(p.get_text("fName"), Some("-1585387669"));
        assert_eq!(p.get_decimal("time"), Some(1_700_000_000_000));
    }

    #[test]
    fn pstack_on_carries_duration() {
        let p = build_pstack_param(1, Some(300_000));
        assert_eq!(p.get_decimal("time"), Some(300_000));
    }

    #[test]
    fn pstack_off_has_no_time() {
        // time 이 붙어 있으면 끄려던 게 다시 켜진다.
        let p = build_pstack_param(1, None);
        assert!(p.entries.get("time").is_none());
        assert_eq!(p.get_decimal("objHash"), Some(1));
    }
}
