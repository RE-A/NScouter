// 설정 항목의 한국어 이름·설명
//
// **근거는 스카우터 공식 설정 문서다** (`official.ts` — `Configure.java` 의 `@ConfigDesc`).
// 공식 문서는 한국어판(`Configuration_kr.md`)도 내용이 영어 원문 그대로라, 여기서 옮겨 적는다.
//
// 지키는 것:
//   · **공식 설명에 없는 말을 보태지 않는다.** 단위·범위·권장값을 짐작해 적으면, 그 짐작이
//     틀렸을 때 화면이 틀린 말을 공식처럼 한다
//   · 공식 설명이 없는 항목(`@ConfigDesc("")`)은 **이름만** 붙인다. 이름은 키를 풀어 쓴 것이고,
//     설명 자리에는 화면이 «공식 설명 없음» 을 적는다
//   · 공식 설명이 항목 이름과 어긋나는 곳(`profile_thread_cputime_enabled` 가 «메모리» 라고
//     적힌 것 등)은 **어긋난다고 적는다** — 한쪽으로 고쳐 쓰면 어느 쪽이 맞는지 알 길이 없어진다
//   · 설명을 비워 둔 항목은 이름만으로 공식 설명이 다 드러나는 것이다(«UDP 포트»).
//     화면은 그 밑에 공식 원문을 늘 같이 보여 준다
//
// 이 앱이 따로 확인한 사실(F-번호)은 그렇다고 밝혀 적는다.

import type { KoCatalog, KoEntry } from './types';

// ─── 에이전트 공통 (자바·호스트) ─────────────────────────────

const AGENT_NETWORK: Record<string, KoEntry> = {
  net_local_udp_ip: ['UDP 로컬 IP'],
  net_local_udp_port: ['UDP 로컬 포트'],
  net_collector_ip: ['콜렉터 IP'],
  net_collector_udp_port: ['콜렉터 UDP 포트'],
  net_collector_tcp_port: ['콜렉터 TCP 포트'],
  net_collector_tcp_session_count: ['콜렉터 TCP 세션 수'],
  net_collector_tcp_so_timeout_ms: ['콜렉터 TCP 소켓 타임아웃(ms)'],
  net_collector_tcp_connection_timeout_ms: ['콜렉터 TCP 연결 타임아웃(ms)'],
  net_udp_packet_max_bytes: ['UDP 버퍼 크기'],
};

const AGENT_OBJECT: Record<string, KoEntry> = {
  obj_type: [
    '(사용 안 함) 오브젝트 타입',
    '더 이상 쓰지 않습니다. monitoring_group_type 의 별칭일 뿐이고, 그 값이 이 값을 덮어씁니다.',
  ],
  monitoring_group_type: [
    '모니터링 그룹 타입',
    '보통 시스템 이름과 모니터링 종류를 붙여 짓습니다. 예) ORDER-JVM, WAREHOUSE-LINUX',
  ],
  obj_name: ['오브젝트 이름'],
};

const AGENT_LOG: Record<string, KoEntry> = {
  log_dir: ['로그 디렉터리'],
  log_rotation_enabled: ['날짜별 로그 파일', '로그를 날짜에 따라 나눠 보관합니다.'],
  log_keep_days: ['로그 보관 기간(일)'],
};

// ─── 자바 에이전트: 패턴 샘플링 (그룹 1~5 가 모양이 같다) ──────

/**
 * 패턴 샘플링 한 그룹.
 *
 * 공식 문서는 그룹 1(`xlog_patterned_`)과 2~5(`xlog_patterned2_` …)에 **같은 설명**을 단다.
 * 다섯 벌을 손으로 적으면 한 벌만 고치고 나머지를 잊는다.
 */
function patternedGroup(n: '' | '2' | '3' | '4' | '5'): Record<string, KoEntry> {
  const p = `xlog_patterned${n}_sampling_`;
  const g = n === '' ? '' : `그룹 ${n} · `;
  return {
    [`${p}enabled`]: [`${g}패턴 샘플링 사용`],
    [`${p}service_patterns`]: [`${g}패턴 샘플링 대상 서비스`, '예) /user/{userId}<GET>,/device/*'],
    [`${p}only_profile`]: [`${g}패턴 샘플링 — 프로파일만`, 'XLog 는 남기고 프로파일만 버립니다.'],
    [`${p}step1_ms`]: [`${g}1구간 경계(ms)`, '0 부터 이 값까지가 1구간(가장 빠른 구간)입니다.'],
    [`${p}step1_rate_pct`]: [`${g}1구간 비율(%)`],
    [`${p}step2_ms`]: [`${g}2구간 경계(ms)`, '1구간 경계부터 이 값까지가 2구간입니다.'],
    [`${p}step2_rate_pct`]: [`${g}2구간 비율(%)`],
    [`${p}step3_ms`]: [`${g}3구간 경계(ms)`, '2구간 경계부터 이 값까지가 3구간(가장 느린 구간)입니다.'],
    [`${p}step3_rate_pct`]: [`${g}3구간 비율(%)`],
    [`${p}over_rate_pct`]: [`${g}3구간 초과 비율(%)`],
  };
}

/** 공식 설명이 항목 이름과 어긋날 때 붙이는 말 */
const MISMATCH = '공식 설명이 항목 이름과 어긋납니다. 아래 원문을 함께 확인하세요.';

/** 공식 설명이 «Deprecated» 인 텔레그래프 항목 */
const TELEGRAF_DEPRECATED =
  '더 이상 쓰지 않습니다 — Telegraf 설정 화면을 쓰세요. 이 값은 무시될 수 있습니다.';

/** 데이터베이스 인덱스 크기 항목 공통 경고 (공식 설명 그대로) */
const INDEX_WARN =
  '[주의] 바꾸면 데이터베이스 파일이 깨집니다. 바꾸기 전에 기존 데이터베이스 파일을 백업하세요. (재시작 필요)';

export const KO: KoCatalog = {
  // ═══ 콜렉터 ══════════════════════════════════════════════
  server: {
    // 로그
    log_tcp_action_enabled: ['TCP 연결 이벤트 기록', 'TCP 연결과 관련된 이벤트를 로그에 남깁니다.'],
    log_udp_multipacket: ['수신한 MultiPacket 기록'],
    log_expired_multipacket: ['만료된 MultiPacket 기록'],
    log_udp_packet: ['수신한 모든 팩 기록'],
    log_udp_counter: ['수신한 CounterPack 기록'],
    log_udp_interaction_counter: ['수신한 PerfInteractionCounterPack 기록'],
    log_udp_xlog: ['수신한 XLogPack 기록'],
    log_udp_profile: ['수신한 ProfilePack 기록'],
    log_udp_text: ['수신한 TextPack 기록'],
    log_udp_alert: ['수신한 AlertPack 기록'],
    log_udp_object: ['수신한 ObjectPack 기록'],
    log_udp_status: ['수신한 StatusPack 기록'],
    log_udp_stack: ['수신한 StackPack 기록'],
    log_udp_summary: ['수신한 SummaryPack 기록'],
    log_udp_batch: ['수신한 BatchPack 기록'],
    log_service_handler_list: ['기동 시 요청 처리기 목록 기록', '기동할 때 모든 요청 처리기를 로그에 남깁니다.'],
    log_udp_span: ['수신한 SpanPack 기록'],
    log_index_traversal_warning_count: [
      '무거운 인덱스 탐색 기록 기준',
      '인덱스 탐색이 너무 무거울 때 로그를 남깁니다.',
    ],
    log_rotation_enabled: ['날짜별 로그 파일', '로그를 날짜에 따라 나눠 보관합니다.'],
    log_keep_days: ['로그 보관 기간(일)'],
    log_sql_parsing_fail_enabled: ['SQL 파싱 실패 기록', '파싱에 실패한 SQL 을 로그에 남깁니다.'],
    _trace: ['내부 추적'],

    // 네트워크
    net_udp_listen_ip: ['UDP 수신 주소'],
    net_udp_listen_port: ['UDP 수신 포트'],
    net_tcp_listen_ip: ['TCP 수신 주소'],
    net_tcp_listen_port: ['TCP 수신 포트'],
    net_tcp_client_so_timeout_ms: ['클라이언트 소켓 타임아웃(ms)'],
    net_tcp_agent_so_timeout_ms: ['에이전트 소켓 타임아웃(ms)'],
    net_tcp_agent_keepalive_interval_ms: ['KEEP_ALIVE 전송 주기(ms)'],
    net_tcp_get_agent_connection_wait_ms: ['에이전트 세션 대기 시간(ms)'],
    net_udp_packet_buffer_size: ['UDP 패킷 버퍼 크기'],
    net_udp_so_rcvbuf_size: ['UDP 수신 버퍼 크기'],
    _net_udp_worker_thread_count: ['UDP 처리 스레드 수'],
    net_tcp_service_pool_size: ['TCP 스레드 풀 크기'],
    net_http_server_enabled: ['HTTP 서버 사용'],
    net_http_port: ['HTTP 포트'],
    net_http_extweb_dir: ['사용자 확장 웹 루트'],
    net_http_api_enabled: ['Scouter HTTP API 사용'],
    net_http_api_swagger_enabled: ['HTTP API Swagger 사용'],
    net_http_api_swagger_host_ip: ['Swagger 호스트', 'Swagger 가 API 를 부를 호스트의 IP 또는 도메인입니다.'],
    net_http_api_cors_allow_origin: ['CORS Allow-Origin', 'API 응답의 Access-Control-Allow-Origin 값입니다.'],
    net_http_api_cors_allow_credentials: ['CORS Allow-Credentials', 'API 응답의 Access-Control-Allow-Credentials 값입니다.'],
    net_webapp_tcp_client_pool_size: ['웹앱 → 콜렉터 연결 풀 크기'],
    net_webapp_tcp_client_pool_timeout: ['웹앱 → 콜렉터 연결 풀 타임아웃'],
    net_webapp_tcp_client_so_timeout: ['웹앱 → 콜렉터 소켓 타임아웃'],
    net_http_api_auth_ip_enabled: ['API 접근 제어 — 클라이언트 IP', '클라이언트 IP 로 API 접근을 제어합니다.'],
    net_http_api_auth_ip_header_key: ['API 호출자 IP 헤더', 'API 호출자의 IP 를 이 HTTP 헤더에서 읽습니다.'],
    net_http_api_auth_session_enabled: ['API 접근 제어 — 세션', '쿠키의 JSESSIONID 로 API 접근을 제어합니다.'],
    net_http_api_session_timeout: ['API 세션 타임아웃'],
    net_http_api_auth_bearer_token_enabled: [
      'API 접근 제어 — Bearer 토큰',
      'Authorization 헤더의 Bearer 토큰으로 API 접근을 제어합니다. 토큰은 /user/loginGetToken 에서 받습니다.',
    ],
    net_http_api_gzip_enabled: ['API 응답 gzip 압축'],
    net_http_api_allow_ips: ['API 접근 허용 IP'],
    allowIpExact: ['허용 IP (정확히 일치)'],
    allowIpMatch: ['허용 IP (패턴 일치)'],

    // 디렉터리
    db_dir: ['데이터베이스 저장 디렉터리'],
    log_dir: ['로그 디렉터리'],
    plugin_dir: ['플러그인 디렉터리'],
    client_dir: ['클라이언트 관련 디렉터리'],
    temp_dir: ['임시 디렉터리'],

    // 오브젝트
    object_deadtime_ms: [
      '오브젝트 비활성 판정 시간(ms)',
      '오브젝트의 하트비트가 멈춘 뒤 이만큼 지나면 비활성으로 판정합니다.',
    ],
    object_inactive_alert_level: ['비활성 오브젝트 알림 레벨', '0: info, 1: warn, 2: error, 3: fatal. 기본 0.'],
    object_zipkin_deadtime_ms: [
      'Zipkin 오브젝트 비활성 판정 시간(ms)',
      'Zipkin 오브젝트의 하트비트가 멈춘 뒤 이만큼 지나면 비활성으로 판정합니다.',
    ],

    // 압축
    compress_xlog_enabled: ['XLog 압축 저장', 'XLog 데이터를 zip 파일로 저장합니다.'],
    compress_profile_enabled: ['프로파일 압축 저장', '프로파일 데이터를 zip 파일로 저장합니다.'],
    _compress_write_buffer_block_count: ['압축 쓰기 버퍼 블록 수'],
    _compress_read_cache_block_count: ['압축 읽기 캐시 블록 수'],
    _compress_read_cache_expired_ms: ['압축 읽기 캐시 만료(ms)'],
    _compress_dailycount_header_cache_size: ['일별 건수 헤더 캐시 크기'],
    _compress_write_thread: ['압축 쓰기 스레드 수'],

    _auto_5m_sampling: ['5분 자동 샘플링'],

    // 데이터 보관·삭제
    mgr_purge_enabled: ['자동 삭제 사용', '데이터베이스의 자동 삭제 기능을 켭니다.'],
    mgr_purge_disk_usage_pct: [
      '자동 삭제 디스크 사용률(%)',
      '디스크 사용률이 이 조건에 닿으면, 오늘 데이터를 뺀 프로파일 데이터부터 지웁니다.',
    ],
    mgr_purge_profile_keep_days: ['프로파일 보관 기간(일)', '자동 삭제 때 보관하는 일수입니다. 프로파일 데이터를 먼저 지웁니다.'],
    mgr_purge_keep_days: ['(사용 안 함) 보관 기간', '더 이상 쓰지 않습니다 — mgr_purge_profile_keep_days 를 쓰세요.'],
    mgr_purge_xlog_keep_days: ['XLog 보관 기간(일)', '자동 삭제 때 보관하는 일수입니다.'],
    mgr_purge_xlog_without_profile_keep_days: [
      '(사용 안 함) 프로파일 없는 XLog 보관 기간',
      '더 이상 쓰지 않습니다 — mgr_purge_xlog_keep_days 를 쓰세요.',
    ],
    mgr_purge_counter_keep_days: ['카운터 보관 기간(일)', '자동 삭제 때 보관하는 일수입니다.'],
    mgr_purge_realtime_counter_keep_days: ['실시간 카운터 보관 기간(일)', '실시간 카운터에만 적용됩니다.'],
    mgr_purge_tag_counter_keep_days: ['태그 카운터 보관 기간(일)', '태그 카운터에만 적용됩니다.'],
    mgr_purge_visitor_counter_keep_days: ['방문자 카운터 보관 기간(일)', '방문자 카운터에만 적용됩니다.'],
    mgr_purge_daily_text_days: ['일별 텍스트 사전 보관 기간(일)', '일별 텍스트 사전에만 적용됩니다.'],
    mgr_purge_sum_data_days: ['요약(통계) 데이터 보관 기간(일)', '요약(통계) 데이터에만 적용됩니다.'],
    mgr_log_ignore_ids: ['로그에서 무시할 ID'],

    // 데이터베이스
    mgr_text_db_daily_service_enabled: [
      '서비스명 일별 사전',
      '켜면 서비스명 사전을 날짜별로 둡니다. 기본(끔)은 영구 사전입니다.',
    ],
    mgr_text_db_daily_api_enabled: ['API 이름 일별 사전', '켜면 API 이름 사전을 날짜별로 둡니다. 기본(끔)은 영구 사전입니다.'],
    mgr_text_db_daily_ua_enabled: ['User-Agent 일별 사전', '켜면 User-Agent 사전을 날짜별로 둡니다. 기본(끔)은 영구 사전입니다.'],
    _mgr_text_db_index_default_mb: ['텍스트 해시 인덱스 기본 메모리(MB)', INDEX_WARN],
    _mgr_text_db_index_service_mb: ['서비스 텍스트 해시 인덱스 메모리(MB)', INDEX_WARN],
    _mgr_text_db_index_api_mb: ['API 텍스트 해시 인덱스 메모리(MB)', INDEX_WARN],
    _mgr_text_db_index_ua_mb: ['User-Agent 텍스트 해시 인덱스 메모리(MB)', INDEX_WARN],
    _mgr_text_db_index_login_mb: ['로그인 텍스트 해시 인덱스 메모리(MB)', INDEX_WARN],
    _mgr_text_db_index_desc_mb: ['desc 텍스트 해시 인덱스 메모리(MB)', INDEX_WARN],
    _mgr_text_db_index_hmsg_mb: ['해시 메시지 텍스트 해시 인덱스 메모리(MB)', INDEX_WARN],
    _mgr_text_db_daily_index_mb: ['일별 텍스트 DB 해시 인덱스 메모리(MB)', INDEX_WARN],
    _mgr_kv_store_index_default_mb: ['키-값 저장소 인덱스 기본 메모리(MB)', INDEX_WARN],
    _mgr_xlog_id_index_mb: ['XLog txid/gxid 인덱스 메모리(MB)', INDEX_WARN],

    // 외부 UI
    ext_link_name: ['외부 UI 이름', '서드파티 UI 의 이름입니다.'],
    ext_link_url_pattern: [
      '외부 UI 링크 패턴',
      '서드파티 UI 로 나가는 링크 패턴입니다(클라이언트 재시작 필요). 차트의 오른쪽 클릭 메뉴에 «Open with 3rd-party UI.» 가 생깁니다.\n' +
        '변수: $[objHashes] 쉼표로 이은 objHash · $[objType] 오브젝트 타입 · $[from] 차트 시작 시각(ms) · $[to] 차트 끝 시각(ms)',
    ],

    // XLog · 프로파일 · Span
    span_queue_size: ['Span 큐 크기'],
    xlog_queue_size: ['XLog 쓰기 큐 크기'],
    xlog_realtime_lower_bound_ms: ['실시간 XLog 조회 무시 시간(ms)', '실시간으로 XLog 를 받을 때 무시하는 시간입니다.'],
    xlog_pasttime_lower_bound_ms: ['과거 XLog 조회 무시 시간(ms)', '지난 XLog 를 조회할 때 무시하는 시간입니다.'],
    profile_queue_size: ['프로파일 쓰기 큐 크기'],
    xlog_sampling_matcher_gxid_keep_memory_count: [
      '연쇄 샘플링 — 메모리에 둘 gxid 수',
      'XLog 연쇄(consequent) 샘플링을 위해 메모리에 보관하는 gxid 개수입니다.',
    ],
    xlog_sampling_matcher_xlog_keep_memory_count: [
      '연쇄 샘플링 — 메모리에 둘 XLog 수',
      'XLog 연쇄 샘플링을 위해 메모리에 보관하는 XLog 개수입니다.',
    ],
    xlog_sampling_matcher_xlog_keep_memory_millis: [
      '연쇄 샘플링 — XLog 최대 보관 시간(ms)',
      'XLog 연쇄 샘플링을 위해 XLog 를 메모리에 두는 최대 시간입니다.',
    ],
    xlog_sampling_matcher_profile_keep_memory_count: [
      '연쇄 샘플링 — 메모리에 둘 프로파일 수',
      '버킷 하나(500ms)에 보관하는 프로파일 개수입니다.',
    ],
    xlog_sampling_matcher_profile_keep_memory_secs: [
      '연쇄 샘플링 — 프로파일 최대 보관 시간(초)',
      'XLog 연쇄 샘플링을 위해 프로파일을 메모리에 두는 최대 시간입니다.',
    ],

    // 부가 기능
    geoip_enabled: ['GeoIP 사용', 'IP 로 도시·국가를 뽑아 냅니다.'],
    geoip_data_city_file: ['GeoIP 데이터 파일 경로'],
    sql_table_parsing_enabled: ['테이블 기준 SQL 압축', '테이블을 기준으로 SQL 을 압축합니다.'],
    tagcnt_enabled: ['TagCount 사용'],
    visitor_hourly_count_enabled: ['시간별 방문자 집계'],

    // 요청 · Telegraf
    req_search_xlog_max_count: [
      'XLog 검색 최대 건수',
      'XLog 검색 요청 한 번에 찾는 최대 건수입니다. (이 앱의 넓은 구간 검색이 이 값을 읽어 «잘렸다» 를 판단합니다.)',
    ],
    input_telegraf_config_file: ['Telegraf 설정 파일 경로'],
    input_telegraf_enabled: ['(사용 안 함) Telegraf 입력', TELEGRAF_DEPRECATED],
    input_telegraf_debug_enabled: ['(사용 안 함) Telegraf 디버그', TELEGRAF_DEPRECATED],
    input_telegraf_delta_counter_normalize_default: ['(사용 안 함) delta 카운터 정규화', TELEGRAF_DEPRECATED],
    input_telegraf_delta_counter_normalize_default_seconds: ['(사용 안 함) delta 카운터 정규화 초', TELEGRAF_DEPRECATED],
    telegraf_object_deadtime_ms: ['(사용 안 함) Telegraf 오브젝트 비활성 판정 시간', TELEGRAF_DEPRECATED],
    'input_telegraf_$measurement$_enabled': [
      'Telegraf 측정값 입력 사용',
      '이 측정값의 Telegraf HTTP 입력을 켭니다. $measurement$ 는 라인 프로토콜의 측정값 이름 자리입니다. 예) input_telegraf_$redis_keyspace$_enabled=true',
    ],
    'input_telegraf_$measurement$_debug_enabled': [
      'Telegraf 라인 프로토콜 출력',
      '이 측정값의 Telegraf 라인 프로토콜을 표준 출력(STDOUT)에 찍습니다.',
    ],
    'input_telegraf_$measurement$_tag_filter': [
      'Telegraf 태그 필터',
      '정하면 이 태그 값에 맞는 지표만 처리합니다. 여럿이면 쉼표로 이으며 «또는» 조건입니다. 예) cpu:cpu-total,cpu:cpu0 · 부정(!) 조건도 됩니다. 예) cpu:!cpu-total',
    ],
    'input_telegraf_$measurement$_counter_mappings': [
      'Telegraf 필드 → 카운터 대응',
      '측정값의 어떤 필드를 스카우터 카운터로 받을지 정합니다. 형식 {필드}:{카운터 이름}:{표시 이름?}:{단위?}:{합계 여부?}:{정규화 초?}, 여럿이면 쉼표로 잇습니다. ' +
        '필드가 & 로 시작하면 초당 증가량(delta)을 남기고 카운터 이름 끝에 _delta 가 붙습니다. && 면 값과 증가량을 모두 남깁니다. 태그 값으로 카운터 이름을 짓는 규칙은 아래 원문을 보세요.',
    ],
    'input_telegraf_$measurement$_objFamily_base': [
      '오브젝트 Family 접두어',
      '오브젝트 Family 는 이 접두어와 태그로 정해집니다. objFamily_append_tags 항목을 함께 보세요.',
    ],
    'input_telegraf_$measurement$_objFamily_append_tags': [
      'Family 에 덧붙일 태그',
      '이 태그 값을 objFamily_base 뒤에 붙입니다. 여럿이면 쉼표. 예) tag1,tag2',
    ],
    'input_telegraf_$measurement$_objType_base': [
      '오브젝트 타입 접두어',
      '오브젝트 타입은 이 접두어와 태그로 정해집니다. objType_prepend_tags · objType_append_tags 항목을 함께 보세요.',
    ],
    'input_telegraf_$measurement$_objType_prepend_tags': [
      '타입 앞에 붙일 태그',
      '이 태그 값을 objType_base 앞에 붙입니다. 여럿이면 쉼표. 예) tag1,tag2',
    ],
    'input_telegraf_$measurement$_objType_append_tags': [
      '타입 뒤에 붙일 태그',
      '이 태그 값을 objType_base 뒤에 붙입니다. 여럿이면 쉼표. 예) tag1,tag2',
    ],
    'input_telegraf_$measurement$_objType_icon': [
      '오브젝트 타입 아이콘',
      '스카우터 클라이언트가 가진 아이콘 파일 이름입니다. 예) redis',
    ],
    'input_telegraf_$measurement$_objName_base': [
      '오브젝트 이름 접두어',
      '오브젝트 이름은 이 접두어와 태그로 정해집니다. objName_append_tags 항목을 함께 보세요.',
    ],
    'input_telegraf_$measurement$_objName_append_tags': [
      '이름에 덧붙일 태그',
      '이 태그 값을 objName_base 뒤에 붙입니다. 여럿이면 쉼표. 예) tag1,tag2',
    ],
    'input_telegraf_$measurement$_host_tag': ['호스트 태그 이름', '호스트를 정하는 태그 이름입니다.'],
    'input_telegraf_$measurement$_host_mappings': [
      '호스트 대응',
      'host_tag 로 정한 호스트 값을 스카우터 호스트에 대응시킵니다. 여럿이면 쉼표. 예) hostValue1:scouterHost1,hostValue2:scouterHost2',
    ],
  },

  // ═══ 자바 에이전트 ═══════════════════════════════════════
  java: {
    ...AGENT_NETWORK,
    net_udp_collection_interval_ms: ['UDP 수집 주기(ms)'],

    ...AGENT_OBJECT,
    obj_host_type: ['호스트 타입'],
    obj_host_name: ['호스트 이름'],
    obj_name_auto_pid_enabled: ['오브젝트 이름에 PID 사용', '프로세스 ID 를 오브젝트 이름으로 씁니다.'],
    obj_type_inherit_to_child_enabled: [
      'DS·RP 타입을 본 오브젝트에 맞춤',
      '데이터소스(DS)·요청 처리기(RP) 오브젝트의 타입을 본 오브젝트에 맞춰 다시 정합니다.',
    ],
    jmx_counter_enabled: [
      'JMX 하위 카운터 수집',
      'JMX 로 하위 카운터를 수집합니다. (이 앱에서 확인: 커넥션 풀(datasource) 카운터를 받으려면 이 값과 앱의 spring.datasource.hikari.register-mbeans 를 모두 켜야 합니다 — F-41)',
    ],

    // 프로파일
    profile_http_querystring_enabled: ['HTTP 쿼리 문자열 프로파일'],
    profile_http_header_enabled: ['HTTP 헤더 프로파일'],
    profile_http_header_url_prefix: ['HTTP 헤더 프로파일 대상 URL 접두어'],
    profile_http_header_keys: ['프로파일할 HTTP 헤더 이름', '쉼표로 구분합니다.'],
    profile_http_parameter_enabled: ['HTTP 파라미터 프로파일'],
    profile_http_parameter_url_prefix: ['HTTP 파라미터 프로파일 대상 URL 접두어'],
    profile_spring_controller_method_parameter_enabled: ['Spring 컨트롤러 메서드 파라미터 프로파일'],
    profile_thread_cputime_enabled: ['스레드 CPU 시간 프로파일', `${MISMATCH} (원문: 메서드별 메모리 사용량 프로파일)`],
    profile_thread_memory_usage_enabled: ['서비스별 메모리 사용량 프로파일'],
    profile_socket_open_fullstack_enabled: ['소켓 열 때 스택 프로파일', '소켓을 열 때의 스레드 스택을 프로파일에 남깁니다.'],
    profile_socket_open_fullstack_port: ['스택을 남길 소켓 포트', '이 포트로 소켓을 열 때만 스레드 스택을 남깁니다.'],
    profile_sqlmap_name_enabled: ['SQL Map 이름 프로파일'],
    profile_connection_open_enabled: ['DB 연결 프로파일'],
    profile_connection_open_fullstack_enabled: ['DB 연결 열 때 스택 프로파일', 'DB 연결을 열 때의 스택 정보를 프로파일에 남깁니다.'],
    profile_connection_autocommit_status_enabled: ['AutoCommit 상태 프로파일'],
    profile_method_enabled: ['메서드 프로파일'],
    profile_step_max_count: ['프로파일 버퍼 크기(스텝 수)'],
    profile_step_max_keep_in_memory_count: ['프로파일 버퍼 크기(메모리 보관 스텝 수)'],
    profile_fullstack_service_error_enabled: ['서비스 에러 시 스택 프로파일'],
    profile_fullstack_apicall_error_enabled: ['API 호출 에러 시 스택 프로파일'],
    profile_fullstack_sql_error_enabled: ['SQL 에러 시 스택 프로파일'],
    profile_fullstack_sql_commit_enabled: ['커밋 에러 시 스택 프로파일'],
    profile_fullstack_hooked_exception_enabled: ['후킹한 예외 발생 시 스택 프로파일', `${MISMATCH} (원문: SQL 에러 시 스택 프로파일)`],
    profile_fullstack_redis_error_enabled: ['Redis 에러 시 스택 프로파일'],
    profile_redis_key_forcibly_stringify_enabled: [
      'Redis 키 강제 문자열 변환',
      '알 수 없는 Redis 키를 new String(byte[]) 로 강제로 문자열로 만듭니다.',
    ],
    profile_fullstack_max_lines: ['에러 시 스택 줄 수'],
    profile_sql_escape_enabled: ['SQL 리터럴 이스케이프', '쿼리를 정규화하려고 리터럴 파라미터를 이스케이프합니다.'],
    _profile_fullstack_sql_connection_enabled: ['SQL 연결 스택 프로파일'],
    _profile_fullstack_sql_execute_debug_enabled: ['SQL 실행 디버그 스택'],
    profile_fullstack_rs_leak_enabled: ['ResultSet 누수 스택 프로파일'],
    profile_fullstack_stmt_leak_enabled: ['Statement 누수 스택 프로파일'],
    profile_elasticsearch_full_query_enabled: [
      'Elasticsearch 쿼리 전문 프로파일',
      'Elasticsearch 쿼리 전문을 프로파일에 남깁니다. 전송량과 디스크를 더 씁니다.',
    ],
    profile_reactor_checkpoint_enabled: ['Reactor 주요 체크포인트 프로파일'],
    profile_reactor_more_checkpoint_enabled: ['Reactor 기타 체크포인트 프로파일'],

    // 추적
    trace_user_mode: [
      '사용자 식별 방식',
      '0: 원격 IP 주소 · 1: 쿠키(JSESSIONID) · 2: 쿠키(SCOUTER) · 3: 헤더. 1(쿠키)과 3(헤더)은 trace_user_session_key 로 이름을 정합니다.',
    ],
    trace_scouter_cookie_max_age: ['SCOUTER 쿠키 만료 시간', 'trace_user_mode 가 2 일 때 SCOUTER 쿠키의 만료 시간입니다.'],
    trace_user_cookie_path: ['SCOUTER 쿠키 경로', 'trace_user_mode 가 2 일 때 SCOUTER 쿠키의 경로입니다.'],
    trace_background_socket_enabled: ['백그라운드 스레드 소켓 추적'],
    trace_service_name_header_key: ['서비스명에 붙일 헤더', '이 헤더 값을 서비스 이름에 덧붙입니다.'],
    trace_service_name_get_key: ['서비스명에 붙일 GET 파라미터', '이 GET 파라미터 값을 서비스 이름에 덧붙입니다.'],
    trace_service_name_post_key: ['서비스명에 붙일 POST 파라미터', '이 POST 파라미터 값을 서비스 이름에 덧붙입니다.'],
    trace_activeserivce_yellow_time: ['액티브 서비스 경고 시간(ms)'],
    trace_activeservice_red_time: ['액티브 서비스 위험 시간(ms)'],
    trace_http_client_ip_header_key: ['원격 IP 헤더', '원격 IP 를 이 헤더에서 읽습니다.'],
    trace_interservice_enabled: ['서비스 간 gxid 연결', 'HTTP 전송에서 gxid 를 이어 서비스 간 호출을 연결합니다.'],
    _trace_interservice_gxid_header_key: ['gxid 헤더 이름'],
    trace_response_gxid_enabled: ['응답에 gxid 싣기'],
    _trace_interservice_callee_header_key: ['callee 헤더 이름'],
    _trace_interservice_caller_header_key: ['caller 헤더 이름'],
    _trace_interservice_caller_obj_header_key: ['caller 오브젝트 헤더 이름'],
    _trace_interservice_callee_obj_header_key: ['callee 오브젝트 헤더 이름'],
    trace_user_session_key: ['사용자 ID 세션 키', '사용자 ID 로 쓸 세션(JSession) 키입니다.'],
    _trace_auto_service_enabled: ['자동 서비스 추적'],
    _trace_auto_service_backstack_enabled: ['자동 서비스 백스택'],
    trace_db2_enabled: ['DB2 추적'],
    trace_webserver_enabled: ['(사용 안 함) 웹서버 추적'],
    trace_webserver_name_header_key: ['(사용 안 함) 웹서버 이름 헤더'],
    trace_webserver_time_header_key: ['(사용 안 함) 웹서버 시간 헤더'],
    trace_request_queuing_enabled: [
      '요청 대기 시간 측정',
      '로드밸런서·리버스 프록시·웹서버 등에서 대기한(queuing) 시간을 잽니다. 켜면 Queuing Time 화면을 열 수 있습니다.',
    ],
    trace_request_queuing_start_host_header: ['요청 시작 서버 헤더', '요청 시작 시각을 적은 서버의 이름을 담는 헤더입니다.'],
    trace_request_queuing_start_time_header: ['요청 시작 시각 헤더', '요청 시작 시각. 형식 t=마이크로초 또는 ts=초.밀리초'],
    trace_request_queuing_start_2nd_host_header: [
      '2단 서버 이름 헤더',
      'trace_request_queuing_start_2nd_time_header 를 적은 서버의 이름을 담는 헤더입니다.',
    ],
    trace_request_queuing_start_2nd_time_header: [
      '2단 서버 통과 시각 헤더',
      '두 번째 계층 서버가 잰 요청 통과 시각. 형식 t=마이크로초 또는 ts=초.밀리초',
    ],
    _trace_fullstack_socket_open_port: ['스택을 남길 소켓 포트(내부)'],
    _trace_sql_parameter_max_count: ['SQL 파라미터 최대 개수'],
    trace_sql_parameter_max_length: [
      'SQL 바인딩 값 최대 길이',
      '프로파일 화면에 남기는 바인딩 파라미터 하나의 최대 길이입니다(500 미만).',
    ],
    trace_delayed_service_mgr_filename: ['지연 서비스 설정 파일 이름'],
    trace_rs_leak_enabled: ['ResultSet 누수 추적'],
    trace_stmt_leak_enabled: ['Statement 누수 추적'],

    // 디렉터리 · 관리
    plugin_dir: ['플러그인 디렉터리'],
    dump_dir: ['덤프 디렉터리'],
    mgr_static_content_extensions: ['정적 콘텐츠 확장자'],
    mgr_log_ignore_ids: ['로그에서 무시할 ID'],

    // 자동 덤프 · 스택
    autodump_enabled: ['자동 덤프 사용', '덤프 디렉터리의 덤프 파일에 덤프를 덧붙여 남깁니다.'],
    autodump_trigger_active_service_cnt: ['자동 덤프 액티브 서비스 기준', '액티브 서비스 수가 이 값을 넘으면 덤프합니다.'],
    autodump_interval_ms: ['자동 덤프 최소 간격(ms)', '하한은 5000 입니다.'],
    autodump_level: ['자동 덤프 종류', '1: 스레드 덤프 · 2: 액티브 서비스 · 3: 스레드 목록'],
    autodump_stuck_thread_ms: ['멈춘 스레드 덤프 기준(ms)', '스레드가 이 시간 넘게 돌고 있으면 덤프합니다. 0 이면 끔.'],
    autodump_stuck_check_interval_ms: ['멈춘 스레드 검사 주기(ms)'],
    autodump_cpu_exceeded_enabled: [
      'CPU 초과 시 덤프',
      '이 프로세스의 CPU 가 기준을 넘으면 덤프 파일을 만듭니다.',
    ],
    autodump_cpu_exceeded_threshold_pct: ['CPU 덤프 기준(%)'],
    autodump_cpu_exceeded_duration_ms: ['CPU 기준 초과 지속 시간(ms)', 'CPU 가 기준을 넘은 채로 이만큼 지속되어야 합니다.'],
    autodump_cpu_exceeded_dump_interval_ms: ['덤프 파일 생성 간격(ms)'],
    autodump_cpu_exceeded_dump_cnt: ['만들 덤프 수'],
    sfa_dump_enabled: ['주기적 스레드 덤프(SFA)'],
    sfa_dump_interval_ms: ['SFA 스레드 덤프 주기(ms)'],
    _psts_enabled: ['주기적 스택 스텝(PSTS)', '일정 간격으로 뜬 스레드 덤프를 프로파일에 남깁니다.'],
    _psts_dump_interval_ms: ['PSTS 덤프 주기(ms)', '하한은 2000 입니다.'],
    _psts_progressive_reactor_thread_trace_enabled: ['Reactor 스레드 점진 추적'],

    // XLog
    xlog_lower_bound_time_ms: ['(사용 안 함) XLog 무시 시간(ms)', '하위 호환용입니다. xlog_sampling_ 항목을 쓰세요.'],
    xlog_error_jdbc_fetch_max: ['과다 fetch 에러 기준(건)', 'fetch 건수가 이 값을 넘으면 XLog 에 에러 메시지를 남깁니다.'],
    xlog_error_sql_time_max_ms: ['느린 쿼리 에러 기준(ms)', '쿼리가 이 시간을 넘으면 XLog 에 에러 메시지를 남깁니다.'],
    xlog_error_check_user_transaction_enabled: [
      'UserTransaction 짝 검사',
      'UserTransaction 의 begin/end 짝이 안 맞으면 XLog 에 에러 메시지를 남깁니다.',
    ],
    xlog_error_on_sqlexception_enabled: ['SQLException 을 에러로 표시'],
    xlog_error_on_apicall_exception_enabled: ['API 호출 에러를 에러로 표시'],
    xlog_error_on_redis_exception_enabled: ['Redis 에러를 에러로 표시'],
    xlog_error_on_elasticsearch_exception_enabled: ['Elasticsearch 에러를 에러로 표시'],
    xlog_error_on_mongodb_exception_enabled: ['MongoDB 에러를 에러로 표시'],
    xlog_discard_service_patterns: [
      'XLog 버릴 서비스 패턴',
      'XLog 는 남기지 않지만 TPS·요약에는 반영합니다. 예) /user/{userId}<GET>,/device/*',
    ],
    xlog_discard_service_show_error: ['버릴 패턴이어도 에러는 남김'],
    xlog_fully_discard_service_patterns: [
      'XLog 완전히 버릴 서비스 패턴',
      'XLog 도 남기지 않고 TPS·요약에도 반영하지 않습니다. 예) /user/{userId}<GET>,/device/*',
    ],

    // XLog 샘플링
    _xlog_hard_sampling_enabled: ['하드 샘플링 사용', '성능은 가장 좋지만 모든 통계 데이터에 영향을 줍니다.'],
    _xlog_hard_sampling_rate_pct: ['하드 샘플링 비율(%)', '이 비율을 넘는 데이터는 버립니다.'],
    ignore_global_consequent_sampling: [
      '전역 연쇄 샘플링 무시',
      '시작 서비스의 샘플링 결정이 하위 호출에 이어지는 연쇄 샘플링을 무시합니다.',
    ],
    xlog_consequent_sampling_ignore_patterns: [
      '연쇄 샘플링 예외 패턴',
      '부모 호출이 샘플링되어 추적 중이어도, 이 패턴의 서비스는 샘플링 비율에 따라 빠질 수 있습니다.',
    ],
    xlog_sampling_exclude_patterns: ['샘플링 제외 패턴'],
    xlog_sampling_enabled: ['샘플링 사용'],
    xlog_sampling_only_profile: ['프로파일만 샘플링', 'XLog 는 남기고 프로파일만 버립니다.'],
    xlog_sampling_step1_ms: ['1구간 경계(ms)', '0 부터 이 값까지가 1구간(가장 빠른 구간)입니다.'],
    xlog_sampling_step1_rate_pct: ['1구간 비율(%)'],
    xlog_sampling_step2_ms: ['2구간 경계(ms)', '1구간 경계부터 이 값까지가 2구간입니다.'],
    xlog_sampling_step2_rate_pct: ['2구간 비율(%)'],
    xlog_sampling_step3_ms: ['3구간 경계(ms)', '2구간 경계부터 이 값까지가 3구간(가장 느린 구간)입니다.'],
    xlog_sampling_step3_rate_pct: ['3구간 비율(%)'],
    xlog_sampling_over_rate_pct: ['3구간 초과 비율(%)'],
    ...patternedGroup(''),
    ...patternedGroup('2'),
    ...patternedGroup('3'),
    ...patternedGroup('4'),
    ...patternedGroup('5'),

    // 알림
    alert_message_length: ['알림 메시지 최대 길이'],
    alert_send_interval_ms: ['같은 알림 최소 간격(ms)'],
    alert_perm_warning_pct: ['PermGen 사용률 알림 기준(%)'],

    // 로그
    ...AGENT_LOG,
    _log_asm_enabled: ['ASM 로그'],
    _log_udp_xlog_enabled: ['UDP XLog 로그'],
    _log_udp_object_enabled: ['UDP 오브젝트 로그'],
    _log_udp_counter_enabled: ['UDP 카운터 로그'],
    _log_datasource_lookup_enabled: ['데이터소스 조회 로그'],
    _log_background_sql: ['백그라운드 SQL 로그'],
    _trace: ['내부 추적'],
    _trace_use_logger: ['추적에 로거 사용'],

    // 후킹
    hook_args_patterns: ['인자 후킹 메서드'],
    hook_return_patterns: ['반환값 후킹 메서드'],
    hook_constructor_patterns: ['생성자 후킹 메서드'],
    hook_connection_open_patterns: ['DB 연결 후킹 메서드'],
    hook_get_connection_patterns: ['getConnection 후킹 메서드'],
    hook_context_classes: ['InitialContext 클래스'],
    hook_method_patterns: ['메서드 후킹 대상'],
    hook_method_ignore_prefixes: ['메서드 후킹 제외 접두어'],
    hook_method_ignore_classes: ['메서드 후킹 제외 클래스'],
    hook_method_exclude_patterns: ['메서드 후킹 제외 패턴'],
    hook_method_access_public_enabled: ['public 메서드 후킹'],
    hook_method_access_private_enabled: ['private 메서드 후킹'],
    hook_method_access_protected_enabled: ['protected 메서드 후킹'],
    hook_method_access_none_enabled: ['접근 제한자 없는 메서드 후킹'],
    hook_method_lambda_enable: ['람다 메서드 후킹'],
    hook_service_patterns: ['서비스 후킹 메서드'],
    hook_service_name_use_1st_string_enabled: [
      '서비스명에 첫 문자열 인자 사용',
      '후킹한 서비스의 이름을 첫 번째 문자열 파라미터로 할지, 클래스·메서드 이름으로 할지 정합니다.',
    ],
    hook_apicall_patterns: ['API 호출 후킹 메서드'],
    hook_apicall_info_patterns: ['API 호출 정보 후킹 메서드'],
    hook_jsp_patterns: ['JSP 후킹 메서드'],
    hook_jdbc_pstmt_classes: ['PreparedStatement 후킹 대상'],
    hook_jdbc_stmt_classes: ['Statement 후킹 대상'],
    hook_jdbc_rs_classes: ['ResultSet 후킹 대상'],
    hook_jdbc_wrapping_driver_patterns: ['DB 연결 래핑 대상'],
    hook_exception_class_patterns: [
      '에러로 볼 예외 클래스',
      '이 예외들은 XLog 화면에서 에러로 보입니다. 예) my.app.BizException,my.app.exception.*Exception',
    ],
    hook_exception_exclude_class_patterns: ['에러에서 뺄 예외 클래스'],
    hook_exception_handler_method_patterns: [
      '예외 처리기 메서드',
      '이 메서드로 넘어간 예외는 XLog 화면에서 에러로 봅니다. 예) my.app.myHandler.handleException',
    ],
    hook_exception_handler_exclude_class_patterns: [
      '예외 처리기에서 뺄 클래스',
      '패턴에 * 를 쓸 수 없습니다. 예) my.app.MyManagedException,MyBizException',
    ],
    hook_async_servlet_enabled: ['비동기 서블릿 후킹'],
    hook_async_servlet_start_patterns: ['startAsync 구현 메서드'],
    hook_async_context_dispatch_patterns: ['asyncContext dispatch 구현 메서드'],
    hook_spring_async_submit_patterns: ['Spring 비동기 submit 패턴'],
    hook_spring_async_enabled: ['Spring 비동기 실행 후킹'],
    hook_async_callrunnable_enable: [
      '(사용 안 함) Callable·Runnable 후킹',
      '더 이상 쓰지 않습니다 — hook_async_callrunnable_enabled 를 쓰세요.',
    ],
    hook_async_callrunnable_enabled: [
      'Callable·Runnable 후킹',
      '비동기 처리를 추적하려고 Callable·Runnable 을 후킹합니다. 스캔 범위 항목(hook_async_callrunnable_scan_package_prefixes)에 든 패키지·클래스만 후킹합니다.',
    ],
    hook_async_callrunnable_scan_package_prefixes: [
      'Callable·Runnable 스캔 범위',
      'Callable·Runnable 구현과 람다를 찾을 패키지 접두어입니다. 보통 애플리케이션 패키지이며, 여럿이면 쉼표로 구분합니다.',
    ],
    _hook_redis_set_key_patterns: [
      'Redis 키 설정 패턴',
      'org.springframework.data.redis.core.AbstractOperations#rawKey 를 참고하세요.',
    ],
    hook_async_thread_pool_executor_enabled: ['스레드 풀 실행기 후킹', '비동기 처리를 추적하려고 스레드 풀 실행기를 후킹합니다.'],
    hook_hystrix_enabled: ['Hystrix 실행 후킹'],
    hook_add_fields: ['필드 추가'],
    _hook_serivce_enabled: ['서비스 후킹'],
    _hook_dbsql_enabled: ['DB SQL 후킹'],
    _hook_dbconn_enabled: ['DB 연결 후킹'],
    _hook_cap_enabled: ['CAP 후킹'],
    _hook_methods_enabled: ['메서드 후킹'],
    _hook_apicall_enabled: ['API 호출 후킹'],
    _hook_socket_enabled: ['소켓 후킹'],
    _hook_jsp_enabled: ['JSP 후킹'],
    _hook_async_enabled: ['비동기 후킹'],
    _hook_usertx_enabled: ['UserTransaction 후킹'],
    _hook_spring_rest_enabled: ['Spring REST 후킹'],
    _hook_redis_enabled: ['Redis 후킹'],
    _hook_kafka_enabled: ['Kafka 후킹'],
    _hook_elasticsearch_enabled: ['Elasticsearch 후킹'],
    hook_mongodb_enabled: ['MongoDB 후킹'],
    _hook_rabbit_enabled: ['RabbitMQ 후킹'],
    _hook_reactive_enabled: ['Reactive 후킹'],
    _hook_coroutine_enabled: ['코루틴 후킹'],
    _hook_coroutine_debugger_hook_enabled: ['코루틴 디버거 후킹'],
    _hook_thread_name_enabled: ['스레드 이름 후킹'],
    _hook_direct_patch_classes: ['직접 패치할 클래스'],
    _hook_boot_prefix: ['부트 접두어'],
    _hook_map_impl_enabled: [
      '큰 Map 경고',
      '항목이 아주 많은 Map 객체를 경고합니다. 시스템 부하가 늘 수 있으니 조심해서 켜세요.',
    ],
    _hook_map_impl_warning_size: ['큰 Map 경고 기준'],

    // 요청 거절
    control_reject_service_enabled: ['요청 거절 사용'],
    control_reject_service_max_count: ['거절 기준 액티브 서비스 수'],
    control_reject_redirect_url_enabled: ['거절 시 URL 로 보내기'],
    control_reject_text: ['거절 응답 문구'],
    control_reject_redirect_url: ['거절 시 보낼 URL'],

    // 카운터
    counter_enabled: ['카운터 수집'],
    counter_recentuser_valid_ms: ['최근 사용자 판정 시간(ms)', '최근 사용자로 셀 think time 입니다.'],
    counter_object_registry_path: ['PID 파일 디렉터리', '프로세스 ID 파일을 만들 디렉터리입니다.'],
    counter_custom_jmx_enabled: ['사용자 JMX 카운터'],
    counter_interaction_enabled: [
      '인터랙션 카운터',
      '인터랙션 카운터를 수집합니다. (이 앱에서 확인: 토폴로지 화면이 이 값이 켜져 있어야 그려집니다 — F-40)',
    ],

    // 요약
    summary_enabled: ['요약 사용'],
    _summary_connection_leak_fullstack_enabled: ['연결 누수 스택'],
    _summary_service_max_count: ['서비스 요약 최대 수'],
    _summary_sql_max_count: ['SQL 요약 최대 수'],
    _summary_api_max_count: ['API 요약 최대 수'],
    _summary_ip_max_count: ['IP 요약 최대 수'],
    _summary_useragent_max_count: ['User-Agent 요약 최대 수'],
    _summary_error_max_count: ['에러 요약 최대 수'],
    _summary_enduser_nav_max_count: ['최종 사용자 탐색 요약 최대 수'],
    _summary_enduser_ajax_max_count: ['최종 사용자 Ajax 요약 최대 수'],
    _summary_enduser_error_max_count: ['최종 사용자 에러 요약 최대 수'],
  },

  // ═══ 호스트 에이전트 ═════════════════════════════════════
  host: {
    ...AGENT_NETWORK,
    ...AGENT_OBJECT,
    ...AGENT_LOG,
    mgr_log_ignore_ids: ['로그에서 무시할 ID'],
    log_udp_object: ['UDP 오브젝트 로그'],
    counter_enabled: ['카운터 수집'],
    counter_object_registry_path: ['PID 파일 디렉터리', '자바 프로세스 ID 파일을 읽을 디렉터리입니다.'],
    counter_netstat_enabled: [
      'netstat 카운터',
      '소켓(ESTABLISHED, TIME_WAIT …)이 너무 많으면 CPU 부하가 커질 수 있습니다.',
    ],
    disk_alert_enabled: ['디스크 알림'],
    disk_warning_pct: ['디스크 경고 기준(%)'],
    disk_fatal_pct: ['디스크 위험 기준(%)'],
    disk_ignore_names: ['알림에서 뺄 디스크'],
    cpu_alert_enabled: ['CPU 알림'],
    cpu_check_period_ms: ['CPU 검사 주기(ms)'],
    cpu_alert_interval_ms: ['CPU 알림 간격(ms)'],
    cpu_warning_pct: ['CPU 경고 기준(%)'],
    cpu_fatal_pct: ['CPU 위험 기준(%)'],
    cpu_warning_history: ['CPU 경고 이력 수'],
    cpu_fatal_history: ['CPU 위험 이력 수'],
    _cpu_value_avg_sec: ['CPU 평균 구간(초)'],
    mem_alert_enabled: ['메모리 알림'],
    mem_alert_interval_ms: ['메모리 알림 간격(ms)'],
    mem_warning_pct: ['메모리 경고 기준(%)'],
    mem_fatal_pct: ['메모리 위험 기준(%)'],
  },
};
