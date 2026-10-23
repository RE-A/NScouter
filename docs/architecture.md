# NScouter 아키텍처 가이드

---

## 1. 시스템 개요

NScouter는 Java 기반 Scouter Eclipse 클라이언트를 **Tauri + Rust + React** 스택으로 포팅한 데스크톱 애플리케이션이다. Java Proxy(scouter.webapp) 없이 **Rust 백엔드가 Collector에 직접 TCP 연결**하여 XLog 데이터를 수신하고, React Canvas로 실시간 스캐터 차트를 렌더링한다.

```
┌──────────────────────────────────────────────────────────────────┐
│                         사용자 PC                                  │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                   NScouter (Tauri App)                   │    │
│  │                                                           │    │
│  │  ┌────────────────┐        ┌─────────────────────────┐   │    │
│  │  │  React 프론트  │  IPC   │     Rust 백엔드          │   │    │
│  │  │  (Webview)     │◄──────►│     (Native)             │   │    │
│  │  │                │ Event  │                           │   │    │
│  │  │  Canvas 차트   │        │  TCP 연결 / 프로토콜      │   │    │
│  │  └────────────────┘        └──────────┬────────────────┘   │    │
│  │                                        │ TCP :6100          │    │
│  └────────────────────────────────────────│────────────────────┘    │
│                                           │                         │
└───────────────────────────────────────────│─────────────────────────┘
                                            │ 방화벽 통과
                                            ▼
                               ┌────────────────────────┐
                               │  Scouter Collector      │
                               │  (모니터링 대상 서버)    │
                               │  :6100 (TCP)            │
                               └────────────────────────┘
```

---

## 2. 레이어 아키텍처

```
┌─────────────────────────────────────────────────────────────────────┐
│                         프레젠테이션 레이어                            │
│                                                                       │
│   App.tsx — 상단 탭 xlog / active / visualize / counter / alert      │
│   features/xlog/components   XLog 차트·목록·상세·검색·오브젝트 작업  │
│   features/active            액티브 서비스 탭                          │
│   features/visualize         KPI·분포·타임라인 탭                     │
│   features/settings, config  앱 설정 / 에이전트·서버 설정 편집        │
│   components/                Pane·Divider·ContextMenu 등 공용 UI      │
├─────────────────────────────────────────────────────────────────────┤
│                         훅 / 상태 레이어                              │
│                                                                       │
│   useXLogStream          useXLogCanvas         그 밖의 use*.ts       │
│   (xlog-data 수집)        (rAF 루프, ResizeObserver, 드래그)          │
│        │                      │                                       │
│        ▼                      ▼                                       │
│   XLogDataStore        XLogChartRenderer                             │
│   (시간 창 + 건수 상한)  (Canvas 렌더링 오케스트레이터)                │
├─────────────────────────────────────────────────────────────────────┤
│                         엔진 레이어 (Canvas 렌더러)                    │
│                                                                       │
│   CoordinateMapper   PointMap        DotImageCache   GridCalculator  │
│   (좌표 변환)         (O(1) 충돌감지)  (OffscreenCanvas)  (눈금 계산) │
│   yScale  densityGrid  pixelQuery  rectSelect                        │
├─────────────────────────────────────────────────────────────────────┤
│                         API 레이어 (Tauri IPC)                        │
│                                                                       │
│   scouterApi.ts — invoke 래퍼 + listen 래퍼 (6장)                    │
│   subscribe.ts  — listen 해지 Promise 를 안전하게 다룬다              │
│   connectFlow.ts / pastXLog.ts — 접속 절차, 과거 XLog 페이지 조회     │
├═════════════════════════════════════════════════════════════════════╡
│                      ──── Tauri IPC 경계 ────                         │
├═════════════════════════════════════════════════════════════════════╡
│                         Tauri Command 레이어 (Rust)                   │
│                                                                       │
│   commands.rs — Command 전부 (목록의 원본은 lib.rs generate_handler) │
│   state.rs    — AppState (연결, 조회용 연결 풀, 스트림 토큰, 설정)    │
│   config.rs   — config.json 읽기/쓰기                                │
│   profile_store.rs / export_store.rs — 프로파일 저장, CSV 내보내기    │
│   object_history_store.rs — 서버별 오브젝트 기록 (재시작 후 복원)    │
├─────────────────────────────────────────────────────────────────────┤
│                         Scouter 프로토콜 레이어 (Rust, scouter/)      │
│                                                                       │
│   connection.rs        streaming.rs       dictionary.rs              │
│   (TCP 연결/로그인)     (XLog 폴링 루프)    (hash→text 캐시)           │
│   xlog_columns.rs (열 묶음 직렬화)  counter / alert / object /       │
│   objtype / family / past / search / profile / profile_search /     │
│   summary / distribution / trace / configure (명령별 파라미터·파싱)  │
│        │                                                              │
│   pack.rs              value.rs           codec.rs                   │
│   (XLogPack/MapPack…)  (ScouterValue)     (ScouterReader/Writer)      │
│        │                    │                    │                    │
│        └────────────────────┴────────────────────┘                   │
│                         protocol.rs (상수)                            │
├─────────────────────────────────────────────────────────────────────┤
│                         네트워크 레이어                                │
│                                                                       │
│   TcpStream (BufReader/BufWriter)                                    │
│   TCP :6100 → Scouter Collector                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 데이터 흐름

### 3.1 연결 → 스트리밍 흐름

```
사용자                프론트엔드              Rust 백엔드          Collector
  │                     │                       │                     │
  │ 연결 버튼 클릭       │                       │                     │
  │────────────────────►│                       │                     │
  │                     │ invoke(connect_scouter)│                     │
  │                     │──────────────────────►│                     │
  │                     │                       │ TCP connect :6100   │
  │                     │                       │────────────────────►│
  │                     │                       │ send 0xCAFE2001     │
  │                     │                       │────────────────────►│
  │                     │                       │ LOGIN (MapPack)     │
  │                     │                       │────────────────────►│
  │                     │                       │◄────────────────────│
  │                     │                       │ session ID          │
  │                     │ emit(scouter-connected)│                     │
  │                     │◄──────────────────────│                     │
  │                     │                       │                     │
  │                     │ invoke(start_xlog_stream)                   │
  │                     │──────────────────────►│                     │
  │                     │                       │ 스트림 전용 연결로   │
  │                     │                       │ 재로그인 후 폴링 시작│
  │                     │                       │ (tokio::spawn, 즉시 │
  │                     │                       │  반환)              │
  │                     │                       │ TRANX_REAL_TIME_GROUP_LATEST
  │                     │                       │────────────────────►│
  │                     │                       │◄────────────────────│
  │                     │                       │ XLogPack (Blob)     │
  │                     │ emit(xlog-data,       │                     │
  │                     │   XLogColumns ≤500건) │                     │
  │                     │◄──────────────────────│                     │
  │ 차트에 점 표시       │                       │                     │
  │◄────────────────────│ rAF → render()        │                     │
  │                     │                       │ (500ms 후 반복...)  │
```

일시 오류는 `xlog-error` 를 보내고 1초 뒤 다시 폴링한다. 세션 만료(`INVALID_SESSION`)면
`xlog-error` 를 보내고 루프를 끝낸다 — 자동 재로그인은 없다 (`streaming.rs`).

### 3.2 XLog 데이터 렌더링 파이프라인

```
Tauri 이벤트 "xlog-data" (XLogColumns — 행이 아니라 열 묶음)
        │
        ▼
useXLogStream (onXLogData 구독)
        │  xlogColumnsToSXLogs() 변환
        ▼
XLogDataStore
  ─ dirty = true
  ─ 시간 창(설정 1~30분)으로 prune, 건수 상한(기본 100,000 · 설정 1만~100만)
        │
        ▼ (rAF 루프에서 dirty 감지)
useXLogCanvas → XLogChartRenderer.render()
        │
        ├─ 1. drawBackground()    배경색 채우기
        ├─ 2. drawIgnoreArea()    무시 영역 (회색 띠)
        ├─ 3. drawYGrid()         Y축 수평 점선 + 레이블
        ├─ 4. drawXGrid(mapper)   X축 수직 점선 + 시간 레이블
        ├─ 5. drawDataPoints()    ★ 핵심
        │       ├─ CoordinateMapper: (endTime, elapsed) → (px, py)
        │       ├─ XLogFilterState: 필터 통과 여부
        │       ├─ PointMap.has(): O(1) 충돌 체크
        │       ├─ getDotColor(): objHash/xType/error → 색상
        │       └─ ctx.drawImage(OffscreenCanvas, px-half, py-half)
        ├─    drawDensity()       밀도 표시 (config.showDensity 일 때만)
        ├─ 6. drawBorder()        테두리
        ├─ 7. drawMetadata()      점 개수, Y축 모드명, 스트림 상태
        └─    drawSelectionRect() 드래그 선택 영역 (선택 중일 때만)
```

---

## 4. Rust 백엔드 모듈 상세

### 4.1 모듈 의존 관계

```
commands.rs
    │
    ├── state.rs (AppState)
    │       ├── connection: Mutex<Option<ScouterConnection>>  (단건 조회·사전)
    │       ├── query_pool: Mutex<Vec<ScouterConnection>>     (objType 조회용, 놀리는 것 최대 4개)
    │       ├── text_cache: Mutex<TextCache>
    │       ├── streams: StreamTokens  (XLog / Counter / Alert 별 Arc<AtomicBool> 중지 토큰)
    │       ├── conn_host·port·user·pass  (스트림 전용 연결을 새로 열 때 쓴다)
    │       └── config: Mutex<AppConfig> + config_path
    │
    ├── config.rs / profile_store.rs / export_store.rs / object_history_store.rs
    │
    ├── scouter/connection.rs
    │       ├── scouter/codec.rs   (ScouterReader / ScouterWriter)
    │       ├── scouter/pack.rs    (XLogPack, MapPack, AnyPack)
    │       ├── scouter/value.rs   (ScouterValue enum)
    │       └── scouter/protocol.rs (상수)
    │
    ├── scouter/streaming.rs
    │       ├── → connection.rs (read_next_pack, send_request)
    │       └── → xlog_columns.rs (emit 직렬화)
    │
    ├── scouter/dictionary.rs
    │       └── → connection.rs (send_request, read_next_pack)
    │
    └── scouter/{counter, alert, object, objtype, family, past, search,
                 profile, profile_search, summary, distribution, trace, configure}.rs
            └── 명령별 파라미터 조립 + 응답 파싱 (요청 자체는 commands.rs 가 connection 으로 보낸다)
```

카운터·알림 스트림은 `streaming.rs` 가 아니라 `commands.rs` 안의 루프가 2초 간격으로 돈다.
`mock_server.rs` 는 통합 테스트(L3)용 가짜 Collector 다.

### 4.2 ScouterConnection 내부 구조

**Collector는 TCP 연결 하나당 명령을 1개만 처리하고 끊는다.** 따라서 `ScouterConnection`은
소켓을 오래 들고 있는 객체가 아니라 **접속 정보 + 세션을 들고 요청마다 소켓을 다시 여는** 객체다.
세션 토큰은 소켓과 무관하게 계속 재사용된다. (실측 근거: [verified-facts.md](verified-facts.md) F-1)

```
ScouterConnection {
    host: String                   ← reopen()에 필요
    port: u16
    reader: BufReader<TcpStream>   ← 현재 요청용 (매 요청마다 교체됨)
    writer: BufWriter<TcpStream>
    session: i64                   ← 로그인 후 발급, 소켓과 무관하게 유지
    server_id: String
}

┌──────────────────────────────────────────────────────┐
│  open_socket()  — 소켓 한 쌍을 만드는 공통 경로        │
│                                                        │
│  1. TcpStream::connect_timeout(addr, 3000ms)          │
│  2. stream.set_nodelay(true)                           │
│  3. writer ← 0xCAFE2001 (BE u32)                      │
│  4. writer.flush()                                    │
└──────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┴──────────────────┐
        ▼                                    ▼
  connect()                          reopen()
  최초 1회. 접속 가능 여부를          send_request() 진입 시마다 호출.
  이 시점에 확인한다.                 이전 소켓은 drop 된다.

┌──────────────────────────────────────────────────────┐
│  send_request(cmd, session, param)                    │
│    1. reopen()          ← 새 소켓 + 매직 넘버          │
│    2. writeText(cmd)                                  │
│    3. writeLong(session)                              │
│    4. writePack(param)                                │
│    5. flush()                                         │
│  이후 호출부는 read_next_pack()을 NO_NEXT까지 반복     │
└──────────────────────────────────────────────────────┘
```

이 구조 덕분에 호출부(`commands.rs` / `streaming.rs` / `dictionary.rs`)는
`send_request` → `read_next_pack` 루프를 그대로 반복하면 되고, 연결 수명을 신경 쓰지 않는다.

`login()`도 `send_request(CMD_LOGIN, 0, param)`을 쓰므로 같은 경로를 탄다.

### 4.3 Scouter 바이너리 프로토콜 요약

```
요청 패킷 구조:
┌──────────────┬──────────────┬────────────────────┐
│ writeText    │ writeLong    │ writePack          │
│ (cmd 문자열) │ (session i64)│ (MapPack 파라미터) │
└──────────────┴──────────────┴────────────────────┘
   Blob 포맷      Big-endian     [0x0A][count][k/v…]

응답 스트림 구조:
[0x03][Pack]  [0x03][Pack] … [0x04]
  HAS_NEXT      HAS_NEXT       NO_NEXT (종료)
  ↓               ↓
  MapPack         XLogPack
  (커서 업데이트)  (점 1개 데이터)

Decimal 가변 길이 인코딩:
  [0x00]              → 0
  [0x01][1B]          → -128..127
  [0x02][2B BE]       → -32768..32767
  [0x03][3B BE]       → Int3 (-8388608..8388607)
  [0x04][4B BE]       → i32
  [0x05][5B BE]       → Long5
  [0x08][8B BE]       → i64

Blob 길이 헤더:
  [0x00]              → 빈 배열
  [1..253]            → 직접 길이
  [0xFF][ushort 2B]   → 254..65535
  [0xFE][int 4B]      → 65536+
```

---

## 5. 프론트엔드 모듈 상세

### 5.1 컴포넌트 트리

주요 것만 적는다. 실제 배치는 `App.tsx` 가 원본이다.

```
App.tsx
├── 헤더: ServerSwitcher · ConnectionDialog · AlertPanel(알림 배지)
├── SettingsDialog / ConfigSettingsDialog / FilterDialog   (대화상자)
├── AgentSelectorPanel                     서버 트리 (타입·그룹·서비스 묶기, 비활성 정리)
└── 상단 탭
    ├── xlog
    │   ├── XLogTabBar · XLogToolbar
    │   ├── XLogChart            ← React.memo
    │   │   ├── useXLogStream()  ─ xlog-data 구독 → XLogDataStore
    │   │   └── useXLogCanvas()  ─ rAF + Canvas 렌더링
    │   ├── SelectionSummary · XLogSearchBar · XLogTable (App.tsx 안)
    │   └── DetailTabBar + XLogDetailPanel
    ├── active     ActiveTab (features/active)
    ├── visualize  VisualizeTab (features/visualize)
    ├── counter    ActiveServicePanel · SummaryPanel · TopologyPanel · ServiceGroupPanel ·
    │              CounterChart · FiveMinCounterChart
    └── alert      AlertFullView (App.tsx 안, 앱이 쥔 알림 버퍼를 그린다)
```

### 5.2 Canvas 엔진 의존 관계

```
XLogChartRenderer
    │
    ├── CoordinateMapper
    │       └── Y_AXIS_CONFIGS (valueExtractor 함수)
    │
    ├── GridCalculator
    │       └── calcNiceInterval() — "nice number" 알고리즘
    │
    ├── PointMap
    │       └── Uint8Array[width × height]
    │             set(x, y, dotSize)  ← 5×5 마킹
    │             has(x, y)          ← O(1) 충돌 체크
    │             queryRect()        ← 드래그 선택
    │
    └── DotImageCache
            └── Map<"color:size", OffscreenCanvas>
                  createDot() — 5×5 + 흰색 노이즈 4픽셀
                  ctx.drawImage(dot, px-2, py-2)  ← 좌상단 기준
```

### 5.3 상태 관리 흐름

```
                Tauri Runtime
                     │
              "xlog-data" 이벤트
                     │
              useXLogStream
                     │  add(SXLog[])
                     ▼
              XLogDataStore ──── dirty flag ────►  useXLogCanvas
              (상한 기본 100,000건)                    │
              (시간 창 1~30분)                rAF 루프 │
                                             dirty 감지│
                                                       ▼
                                          XLogChartRenderer.render()
                                                       │
                                                  <canvas>
```

### 5.4 창 여럿 — 떼어 낸 XLog 창

```
메인 창 (App)                                 뗀 창 xlogwin-N (같은 App, windowLabel 있음)
 · 접속 · 서버 전환 · Counter/Active/…          · XLog 화면만: 서버 고르기 · 툴바 · 탭·분할 · 목록 · 상세
 · 창 목록(registry) → config.xlog_windows      · 파일에 안 쓴다 — snapshot 으로 메인 창에 알린다
 · 켤 때 같은 자리에 다시 연다
        ◄── hello / snapshot / merge(닫을 때도) / detach ──
        ─── init (탭·분할) ──►                    (detached/protocol.ts)

Rust: start_xlog_stream(창별 오브젝트) → xlog_subs 합집합으로 스트림 하나 → "xlog-data" 를 모든 창에
```

- 창마다 App 상태를 한 벌씩 든다. 탭은 떼는 순간 보낸 창에서 빠져 받은 창의 것이 된다
- XLog 스트림만 창별 합집합이다. 카운터·알림 스트림은 메인 창만 연다 (하나뿐이라 뗀 창이 열면 메인 창 화면이 바뀐다)
- 창 이름 꼴(`xlogwin-*`)은 `capabilities/default.json` 의 창 목록과 맞아야 한다 — 안 맞으면 뗀 창이 이벤트를 못 쓴다

---

## 6. Tauri IPC 인터페이스

### 6.1 invoke (JS → Rust)

Command 는 60개가 넘는다. **목록의 원본은 `src-tauri/src/lib.rs` 의 `generate_handler!`**,
파라미터·반환 타입은 `src/features/xlog/api/scouterApi.ts` 의 래퍼가 원본이다. 여기는 묶음만 적는다.

| 묶음 | 커맨드 |
|------|--------|
| 연결 | `connect_scouter` `disconnect_scouter` |
| 스트림 | `start_xlog_stream` `stop_xlog_stream` `start_counter_stream` `stop_counter_stream` `start_alert_stream` `start_mock_stream` |
| XLog 조회 | `load_past_xlog` `load_xlog_by_gxid` `search_xlog_list` `get_search_max` `get_xlog_distribution` `get_xlog_detail` |
| 프로파일 | `get_xlog_profile` `get_xlog_full_profile` `search_profiles` `save_xlog_profile` `list_saved_profiles` `open_saved_profile` `get_profile_dir` |
| 집계 | `get_summary` `get_error_summary` `get_interaction` `get_service_group` `get_active_speed` `get_active_speed_by_object` `get_past_counter` `get_today_counter` `get_today_visitor` |
| 오브젝트 | `get_object_list` `load_object_history` `save_object_history` `remove_inactive_objects` `get_object_type_families` `get_object_env` `get_object_thread_list` `get_object_sockets` `get_object_class_list` `get_object_active_services` `get_type_active_services` `get_object_heap_histogram` `get_thread_detail` `get_stack_index` `get_stack_dump` |
| 오브젝트 작업 | `trigger_dump` `object_system_gc` `object_reset_cache` `object_stack_sampling` `object_heap_dump` `get_dump_file_list` `get_dump_file_content` |
| 원격 설정 | `get_agent_config` `save_agent_config` `get_server_config` `save_server_config` |
| 텍스트 사전 | `resolve_texts` |
| 앱 설정·파일 | `get_config` `save_config` `save_ui_state` `save_servers` `set_log_level` `save_csv_export` `get_export_dir` |

### 6.2 emit (Rust → JS)

| 이벤트 | 페이로드 | 설명 |
|--------|----------|------|
| `xlog-data` | `XLogColumns` (열 묶음, 최대 500건) | XLog 트랜잭션 묶음 |
| `xlog-error` | `{ message: string }` | 스트리밍 오류 |
| `counter-data` | `CounterUpdate` | 실시간 카운터 |
| `counter-error` | `{ message: string }` | 카운터 스트림 오류 |
| `alert-data` | `AlertPack` | 알림 1건 |
| `scouter-connected` | `server_id: string` | 연결 완료 |
| `scouter-disconnected` | — | 연결 해제 |

---

## 7. XLogPack 필드 구조

XLogPack은 Collector로부터 수신 시 **전체가 Blob으로 래핑**된 형태로 전달된다. 내부에는 43개 필드가 순서대로 직렬화되어 있으며, 필드 21번부터는 `remaining() > 0` 체크 후 조건부 파싱한다 (구버전 서버 호환).

```
[PackType=0x15]
[Blob (XLogPack 전체 데이터)]
   └── 내부 ScouterReader:
       1.  endTime          readDecimal()  → i64   종료 시각 (epoch ms)
       2.  objHash          readDecimal()  → i32   에이전트 해시
       3.  service          readDecimal()  → i32   서비스 해시 (GET_TEXT_100 으로 조회)
       4.  txid             readLong()     → i64   트랜잭션 ID (JS에서 string 처리)
       5.  caller           readLong()     → i64   호출자 txid
       6.  gxid             readLong()     → i64   글로벌 트랜잭션 ID
       7.  elapsed          readDecimal()  → i32   응답시간 ms ★ 스캐터 Y축
       8.  error            readDecimal()  → i32   에러 해시 (0=정상)
       9.  cpu              readDecimal()  → i32   CPU 시간 ms
       10. sqlCount         readDecimal()  → i32
       11. sqlTime          readDecimal()  → i32
       12. ipaddr           readBlob()     → Vec<u8>  → "x.x.x.x"
       ... (필드 13~20)
       21+. available() > 0 체크 후 조건부 읽기 (country_code ~ ignoreGlobalSampling)
```

---

## 8. 색상 규칙 (XLog 점 색상)

ASIS `XLogViewPainter.drawXPerfData()` 의 **규칙**을 포팅했다. 색값은 어두운 판에 맞춰 다르다
(원본: `src/features/xlog/utils/colorPalette.ts` `getDotColor`).

```
xType == 3 또는 4 (비동기/백그라운드 스레드)
    error != 0  →  XLOG_COLORS.ERROR_LIGHT   (흐린 빨강, 토큰 --xlog-dim-error)
    error == 0  →  XLOG_COLORS.NORMAL_LIGHT  (흐린 회청, 토큰 --xlog-dim)

그 밖의 xType (일반 트랜잭션)
    error != 0  →  XLOG_COLORS.ERROR         (#ff4d4f)
    error == 0  →  objHash 기반 에이전트 색상
                   (AGENT_COLORS 를 Math.abs(objHash) % AGENT_COLORS.length 로 순환)
```

흐린 색·판·눈금·글자는 테마 토큰을 따르고(`refreshXLogColors`), 에러색과 에이전트 순환색은
테마와 무관하게 고정이다.

---

## 9. 성능 설계

| 항목 | 방식 | 효과 |
|------|------|------|
| 점 충돌 감지 | `Uint8Array PointMap` | O(1) — 배열 순회(O(n)) 대비 수만 배 빠름 |
| 점 렌더링 | `OffscreenCanvas drawImage` | ~4ms/50k점 — `fillRect`(12ms), `arc`(25ms) 대비 우수 |
| 데이터 상한 | 시간 창(1~30분) + 건수 상한(기본 100,000) | 메모리 무한 증가 방지 |
| IPC 페이로드 | `XLogColumns` 열 묶음, 500건씩 분할 emit | 직렬화 비용 감소, 첫 묶음부터 그리기 |
| rAF dirty flag | `isDirty()` 체크 후 렌더 | 새 데이터 없으면 렌더링 스킵 |
| Decimal 인코딩 | 1~9바이트 가변 | 네트워크 대역폭 절감 |
| txid 직렬화 | Rust에서 String으로 | JS `Number.MAX_SAFE_INTEGER` 초과 방지 |
