# XLog 스캐터 차트 Canvas 렌더러 프로토타입 계획서

## 1. 컨텍스트

### 1.1 목표
Scouter의 `XLogViewPainter.java` (941줄, SWT GC 기반)를 HTML5 Canvas API로 포팅하여, Tauri + React 환경에서 초당 수만 개의 XLog 트랜잭션 데이터를 렉 없이 실시간 렌더링하는 스캐터 차트를 구현한다.

### 1.2 원본 분석
- **원본 파일:** `XLogViewPainter.java` (941줄)
- **렌더링 방식:** SWT GC (Graphics Context) 기반 2D 렌더링
- **핵심 로직:** 좌표 매핑, 그리드 계산, 점 충돌 감지, 필터링, 드래그 선택/줌
- **의존성:** `ChartUtil.java` (그리드 계산), `XLogData` (데이터 모델), SWT Color/Font 시스템

### 1.3 기술 제약
- DOM 기반 렌더링(SVG, div) **절대 금지** — 반드시 Canvas API 직접 제어
- Java Proxy Server를 통한 데이터 수신 (WebSocket 실시간 + REST API 단건)
- TypeScript Strict 모드, `any` 타입 사용 금지
- React Functional Component + Hooks 패턴 준수

---

## 2. 파일 구조

```
src/features/xlog/
├── types/
│   ├── xlog.ts                  # SXLog, XLogRenderItem 등 핵심 데이터 타입
│   ├── chart-config.ts          # XLogChartConfig, ChartLayout, YAxisMode
│   └── filter.ts                # XLogFilterState, FilterPreset
├── engine/
│   ├── PointMap.ts              # Uint8Array 기반 비트맵 충돌 감지
│   ├── DotImageCache.ts         # 5x5 dot ImageBitmap 캐시
│   ├── GridCalculator.ts        # ChartUtil.java 포팅 — 그리드 간격/레이블 계산
│   ├── CoordinateMapper.ts      # 데이터 좌표 ↔ 캔버스 픽셀 좌표 변환
│   └── XLogChartRenderer.ts     # 메인 렌더러 (Canvas 2D 드로잉 오케스트레이터)
├── hooks/
│   ├── useXLogRealTimeData.ts   # 2초 폴링 기반 실시간 데이터 fetching
│   ├── useXLogCanvas.ts         # Canvas ref 관리 + rAF 루프 구동
│   └── useXLogInteraction.ts    # 마우스/키보드 이벤트 핸들링
├── store/
│   └── XLogDataStore.ts         # 시간 윈도우 기반 XLog 데이터 관리
├── components/
│   ├── XLogChart.tsx            # 메인 차트 컴포넌트 (Canvas 래핑)
│   ├── XLogToolbar.tsx          # 필터, Y축 모드 전환 등 제어 UI
│   └── XLogTooltip.tsx          # 점 hover 시 트랜잭션 상세 팝업
├── api/
│   └── xlogApi.ts               # Java Proxy REST/WebSocket 통신 계층
└── utils/
    ├── colorPalette.ts          # 서비스별 색상 매핑
    └── formatters.ts            # 시간/응답시간 포맷터
```

---

## 3. TypeScript 인터페이스 정의

### 3.1 핵심 데이터 타입 (`types/xlog.ts`)

> **API 선택**: `/v1/xlog`(Raw)는 service/objName 등이 정수 hash로 반환된다.
> `/v1/xlog-data`(Decoded)는 딕셔너리 텍스트가 미리 디코딩된 문자열로 반환된다.
> **신규 클라이언트는 `/v1/xlog-data`를 사용한다.** 단, 딕셔너리 로드 지연(최대 2초) 동안 일부 필드가 빈 문자열로 반환될 수 있다.

```typescript
/** Scouter XLog 디코딩된 데이터 (Java Proxy /v1/xlog-data API 응답) */
interface SXLog {
  txid: bigint;           // 트랜잭션 고유 ID — Java long, JSON에서 string으로 수신 후 BigInt 변환 필요
  gxid: bigint;           // 글로벌 트랜잭션 ID (분산 추적용)
  endTime: number;        // 종료 시각 (epoch ms)
  elapsed: number;        // 응답 시간 (ms)
  objHash: number;        // 에이전트 객체 해시
  service: string;        // 서비스 이름 (URL 패턴) — xlog-data에서는 디코딩된 문자열
  error: number;          // 에러 코드 (0이면 정상)
  xType: number;          // 트랜잭션 유형 (0=WEB, 3=ASYNCSERVLET_DISPATCHED, 4=BACK_THREAD2)
  cpu: number;            // CPU 사용 시간 (ms)
  sqlCount: number;       // SQL 호출 횟수
  sqlTime: number;        // SQL 총 소요 시간 (ms)
  apiCallCount: number;   // 외부 API 호출 횟수
  apiCallTime: number;    // 외부 API 총 소요 시간 (ms)
  ipAddr: string;         // 클라이언트 IP
  allocKBytes: number;    // 할당 메모리 (kbytes — ASIS 필드명: kbytes)
  threadName: string;     // 스레드 이름
}

/** 실시간 XLog 폴링 응답 래퍼 */
interface XLogRealTimeResponse {
  xlogLoop: number;       // 다음 요청에 사용할 loop 오프셋
  xlogIndex: number;      // 다음 요청에 사용할 index 오프셋
  xlogs: SXLog[];
}

/** 이력 XLog 페이징 응답 래퍼 */
interface XLogPageResponse {
  xlogs: SXLog[];
  hasMore: boolean;
  lastTxid: bigint | null;     // 다음 페이지 커서 — txid와 반드시 함께 사용
  lastXLogTime: number | null; // 다음 페이지 커서 — 둘 중 하나만 있으면 서버 에러
}

/** 렌더링 파이프라인 내부에서 사용하는 점 데이터 */
interface XLogRenderItem {
  xlog: SXLog;
  x: number;              // 캔버스 X 좌표 (px)
  y: number;              // 캔버스 Y 좌표 (px)
  dotColor: string;       // 해당 점의 색상 (#RRGGBB)
  filtered: boolean;      // 필터에 의해 숨김 처리 여부
  selected: boolean;      // 드래그 선택 여부
}
```

### 3.2 Y축 모드 및 차트 설정 (`types/chart-config.ts`)

```typescript
/** Y축 표시 모드 — ASIS XLogYAxisEnum 대응 */
type YAxisMode = 'elapsed' | 'cpu' | 'sqlTime' | 'sqlCount' | 'apiCallTime' | 'apiCallCount' | 'heapUsed';

/** Y축 모드별 설정값 — ASIS XLogYAxisEnum 분석 기반 */
interface YAxisModeConfig {
  mode: YAxisMode;
  label: string;          // 축 레이블
  defaultMax: number;     // Y축 기본 최대값 (ASIS 소스에서 확인된 실제값)
  unit: string;           // 단위 문자열
  valueExtractor: (xlog: SXLog) => number;  // SXLog에서 값 추출 함수
}

/**
 * ASIS XLogViewPainter.java에서 확인된 Y축 모드별 설정값
 * 주의: elapsed/sqlTime/apiCallTime은 ms → 초(÷1000) 변환 후 표시
 */
const Y_AXIS_MODE_CONFIGS: Record<YAxisMode, YAxisModeConfig> = {
  elapsed:      { mode: 'elapsed',      label: 'Elapsed(sec)',      defaultMax: 9,    unit: 'sec', valueExtractor: x => x.elapsed / 1000 },
  cpu:          { mode: 'cpu',          label: 'CPU(ms)',           defaultMax: 100,  unit: 'ms',  valueExtractor: x => x.cpu },
  sqlTime:      { mode: 'sqlTime',      label: 'SQL Time(sec)',     defaultMax: 9,    unit: 'sec', valueExtractor: x => x.sqlTime / 1000 },
  sqlCount:     { mode: 'sqlCount',     label: 'SQL Count',         defaultMax: 50,   unit: '',    valueExtractor: x => x.sqlCount },
  apiCallTime:  { mode: 'apiCallTime',  label: 'ApiCall Time(sec)', defaultMax: 9,    unit: 'sec', valueExtractor: x => x.apiCallTime / 1000 },
  apiCallCount: { mode: 'apiCallCount', label: 'ApiCall Count',     defaultMax: 50,   unit: '',    valueExtractor: x => x.apiCallCount },
  heapUsed:     { mode: 'heapUsed',     label: 'Heap Used(KB)',     defaultMax: 5000, unit: 'KB',  valueExtractor: x => x.allocKBytes },
};

/** 차트 전체 설정 */
interface XLogChartConfig {
  yAxisMode: YAxisMode;
  timeRangeMs: number;        // X축 시간 범위 (기본 300,000ms = 5분)
  yMax: number;               // Y축 최대값
  autoScale: boolean;         // Y축 자동 스케일 여부
  showIgnoreArea: boolean;    // 무시 영역 표시 여부
  ignoreThresholdMs: number;  // 무시 기준 응답 시간 (ms)
  dotSize: number;            // 점 크기 (기본 5px)
  backgroundColor: string;    // 배경색
  gridColor: string;          // 그리드 선 색상
  borderColor: string;        // 테두리 색상
}

/** 차트 레이아웃 (패딩, 축 영역 등) */
interface ChartLayout {
  canvasWidth: number;
  canvasHeight: number;
  paddingTop: number;         // 상단 여백 (기본 10)
  paddingRight: number;       // 우측 여백 (기본 10)
  paddingBottom: number;      // 하단 여백 — X축 레이블 영역 (기본 30)
  paddingLeft: number;        // 좌측 여백 — Y축 레이블 영역 (기본 60)
  plotAreaX: number;          // 플롯 영역 시작 X (= paddingLeft)
  plotAreaY: number;          // 플롯 영역 시작 Y (= paddingTop)
  plotAreaWidth: number;      // 플롯 영역 너비
  plotAreaHeight: number;     // 플롯 영역 높이
}
```

### 3.3 필터 상태 (`types/filter.ts`)

```typescript
/** XLog 필터 상태 */
interface XLogFilterState {
  servicePattern: string;       // 서비스 이름 정규식 패턴
  minElapsed: number;           // 최소 응답 시간 필터
  maxElapsed: number;           // 최대 응답 시간 필터 (0이면 무제한)
  errorOnly: boolean;           // 에러 트랜잭션만 표시
  objHashSet: Set<number>;      // 특정 에이전트만 표시 (빈 Set이면 전체)
  excludePatterns: string[];    // 제외할 서비스 패턴 목록
}
```

---

## 4. 엔진 모듈 상세 설계

### 4.1 PointMap — 비트맵 충돌 감지

```typescript
/**
 * Uint8Array 기반 2D 비트맵으로 점 충돌 감지를 O(1)에 수행.
 * 원본 XLogViewPainter.java의 pointMap 로직 포팅.
 *
 * 캔버스의 각 픽셀 위치에 이미 점이 그려져 있는지 체크하여,
 * 동일 위치에 중복 그리기를 방지하고 hover 시 해당 위치의 점을 빠르게 식별.
 */
class PointMap {
  private bitmap: Uint8Array;   // width * height 크기
  private width: number;
  private height: number;

  constructor(width: number, height: number);

  /** 해당 좌표에 점이 존재하는지 O(1) 확인 */
  has(x: number, y: number): boolean;

  /** 해당 좌표에 점 등록 (5x5 영역 마킹) */
  set(x: number, y: number, dotSize: number): void;

  /** 전체 비트맵 초기화 (프레임마다 호출) */
  clear(): void;

  /** 드래그 영역 내 점 인덱스 목록 반환 */
  queryRect(x1: number, y1: number, x2: number, y2: number): number[];
}
```

**성능 포인트:**
- `Uint8Array`를 사용하여 메모리 효율적 (1 pixel = 1 byte)
- 충돌 체크 시간 복잡도: O(1)
- 50,000개 점 기준 초기화 시간: ~0.5ms (`TypedArray.fill(0)`)

### 4.2 DotImageCache — 5x5 점 이미지 캐시

```typescript
/**
 * 점 색상별로 미리 렌더링된 5x5 ImageBitmap을 캐시.
 * 매 프레임마다 arc()나 fillRect()를 수만 번 호출하는 대신,
 * drawImage()로 캐시된 비트맵을 블리팅하여 렌더링 성능 극대화.
 */
class DotImageCache {
  private cache: Map<string, ImageBitmap>;

  /** 색상에 해당하는 5x5 ImageBitmap 반환 (없으면 생성 후 캐시) */
  getDot(color: string, size: number): ImageBitmap;

  /** 캐시 전체 초기화 */
  clear(): void;

  /** 특정 색상의 캐시 무효화 */
  invalidate(color: string): void;
}
```

**생성 전략 — ASIS `ImageCache.createXPImage6()` 포팅:**
1. OffscreenCanvas(5, 5) 생성
2. 해당 색상으로 5×5 사각형 그리기 (`fillRect(0, 0, 5, 5)`)
3. 흰색 노이즈 픽셀 4개 배치 — ASIS 소스에서 확인된 좌표 (1,0), (4,1), (0,3), (3,4)
4. `createImageBitmap()`으로 변환 후 Map에 저장
5. 이후 `ctx.drawImage(cachedBitmap, x, y)` 호출로 블리팅 (좌상단 기준, 중심 아님)

> **주의**: ASIS에서 `gc.drawImage(dot, d.x, d.y)` — `d.x`, `d.y`는 이미 좌상단 기준 좌표이다. 중심 기준으로 계산하면 위치가 2픽셀씩 어긋난다.

**색상 규칙 (`utils/colorPalette.ts`):**
```typescript
// ASIS XLogViewPainter.drawXPerfData() 로직 포팅
export const XLOG_DOT_COLORS = {
  ERROR:        '#FF0000',   // 에러 트랜잭션 (xType 0,1,2)
  ERROR_LIGHT:  '#FF9999',   // 에러 트랜잭션 (xType 3=ASYNCSERVLET_DISPATCHED, 4=BACK_THREAD2)
  NORMAL_LIGHT: '#AAAAAA',   // 정상 트랜잭션 (xType 3 또는 4)
  // 정상 트랜잭션 (xType 0,1,2): objHash 기반 에이전트 색상 할당
  GRID:         'rgb(220, 228, 255)',
  GRID_WIDE:    'rgb(200, 208, 255)',
  FILTER_BG:    '#F0FFFF',   // 필터 활성 시 배경 (azure)
  IGNORE_AREA:  'rgb(234, 234, 234)',
} as const;

export function getDotColor(objHash: number, xType: number, hasError: boolean): string {
  const isLightType = xType === 3 || xType === 4;
  if (hasError) return isLightType ? XLOG_DOT_COLORS.ERROR_LIGHT : XLOG_DOT_COLORS.ERROR;
  if (isLightType) return XLOG_DOT_COLORS.NORMAL_LIGHT;
  return getAgentColor(objHash);  // objHash 기반 팔레트 색상
}
```

### 4.3 GridCalculator — ChartUtil.java 포팅

```typescript
/**
 * Scouter 원본 ChartUtil.java의 그리드 간격 계산 로직 포팅.
 * "nice number" 알고리즘으로 사람이 읽기 쉬운 그리드 간격 산출.
 */
class GridCalculator {
  /**
   * 주어진 범위와 원하는 눈금 개수로 "nice" 간격 계산.
   * 예: range=4700, desiredTicks=5 → interval=1000
   */
  static calcNiceInterval(range: number, desiredTicks: number): number;

  /** X축(시간) 그리드 정보 생성 */
  static calcTimeGrid(
    startTime: number,
    endTime: number,
    plotWidth: number
  ): GridInfo;

  /** Y축(값) 그리드 정보 생성 */
  static calcValueGrid(
    minValue: number,
    maxValue: number,
    plotHeight: number
  ): GridInfo;
}

interface GridInfo {
  interval: number;         // 그리드 간격 (시간 ms 또는 값)
  lines: GridLine[];        // 실제 그려야 할 그리드 라인 목록
}

interface GridLine {
  value: number;            // 해당 라인의 실제 값
  position: number;         // 캔버스 상의 픽셀 위치
  label: string;            // 표시할 레이블 텍스트
}
```

### 4.4 CoordinateMapper — 좌표 변환

```typescript
/**
 * 데이터 좌표 (시간, 응답시간)와 캔버스 픽셀 좌표 간 양방향 변환.
 */
class CoordinateMapper {
  constructor(layout: ChartLayout, config: XLogChartConfig);

  /** 데이터 좌표 → 캔버스 픽셀 좌표 */
  dataToPixel(time: number, value: number): { x: number; y: number };

  /** 캔버스 픽셀 좌표 → 데이터 좌표 */
  pixelToData(px: number, py: number): { time: number; value: number };

  /** 특정 시간값의 X 픽셀 위치 */
  timeToX(time: number): number;

  /** 특정 값의 Y 픽셀 위치 */
  valueToY(value: number): number;
}
```

### 4.5 XLogChartRenderer — 메인 렌더러

```typescript
/**
 * Canvas 2D 렌더링 오케스트레이터.
 * 각 레이어를 정해진 순서대로 그리는 메인 드로잉 루프.
 */
class XLogChartRenderer {
  private ctx: CanvasRenderingContext2D;
  private layout: ChartLayout;
  private config: XLogChartConfig;
  private pointMap: PointMap;
  private dotCache: DotImageCache;
  private gridCalc: typeof GridCalculator;
  private coordMapper: CoordinateMapper;

  constructor(canvas: HTMLCanvasElement, config: XLogChartConfig);

  /** 전체 프레임 렌더링 (rAF에서 호출) */
  render(data: SXLog[], filter: XLogFilterState, now: number): void;

  /** 캔버스 크기 변경 대응 */
  resize(width: number, height: number): void;

  /** 리소스 해제 */
  dispose(): void;
}
```

---

## 5. 데이터 플로우

```
┌──────────────────┐     REST (2s 폴링)     ┌────────────────────────┐
│  Java Proxy      │ ◄────────────────────── │  useXLogRealTimeData   │
│  Server          │     /xlog/realtime      │  (React Hook)          │
│                  │                         │  - 2초 간격 폴링       │
│  (Scouter        │     WebSocket (향후)    │  - 응답 파싱/검증      │
│   Collector      │ ◄───────────────────── │  - 에러 재시도 로직     │
│   Proxy)         │                         └───────────┬────────────┘
└──────────────────┘                                     │
                                                         │ SXLog[]
                                                         ▼
                                              ┌────────────────────────┐
                                              │  XLogDataStore         │
                                              │  - 시간 윈도우 관리     │
                                              │  - 만료 데이터 자동 삭제 │
                                              │  - 최대 100,000건 유지  │
                                              │  - dirty flag 관리      │
                                              └───────────┬────────────┘
                                                         │
                                                         │ SXLog[] (현재 윈도우)
                                                         ▼
                                              ┌────────────────────────┐
                                              │  useXLogCanvas         │
                                              │  (React Hook)          │
                                              │  - Canvas ref 관리     │
                                              │  - rAF 루프 구동       │
                                              │  - dirty flag 체크     │
                                              │  - resize observer     │
                                              └───────────┬────────────┘
                                                         │
                                                         │ render() 호출
                                                         ▼
                                              ┌────────────────────────┐
                                              │  XLogChartRenderer     │
                                              │  - 레이어별 순차 드로잉 │
                                              │  - PointMap 충돌 관리   │
                                              │  - DotImageCache 활용  │
                                              └───────────┬────────────┘
                                                         │
                                                         │ drawImage / fillRect
                                                         ▼
                                              ┌────────────────────────┐
                                              │  <canvas> Element      │
                                              │  (화면 출력)            │
                                              └────────────────────────┘
```

### 5.1 데이터 수신 상세 — 오프셋 기반 HTTP 폴링

> **중요**: `/v1/xlog-data`는 **WebSocket이 아닌 오프셋 기반 HTTP 폴링**이다.
> ASIS 분석에서 확인: `BasicSocket.java`는 미구현 상태이며, 실시간 데이터는 loop/index 오프셋으로 폴링한다.

**실시간 XLog 엔드포인트:**
```
GET /v1/xlog-data/realTime/{offset1}/{offset2}
  - offset1 = xlogLoop (이전 응답에서 수신, 최초 요청 시 0)
  - offset2 = xlogIndex (이전 응답에서 수신, 최초 요청 시 0)
  - Query: objHashes (쉼표 구분 int 목록), serverId
  - 응답: { xlogLoop, xlogIndex, xlogs: XLogData[] }
```

**이력 XLog 엔드포인트:**
```
GET /v1/xlog-data/{yyyymmdd}
  - Query: startTimeMillis, endTimeMillis, objHashes, pageCount(max 30000)
  - 페이지 이동: lastTxid + lastXLogTime (반드시 둘 다 포함 또는 둘 다 생략)
  - 응답: Streaming JSON { xlogs, hasMore, lastTxid, lastXLogTime }

주의: 날짜 경계(자정) 걸치는 경우 yyyymmdd를 달리하여 두 번 요청 필요
```

**단건 조회:**
```
GET /v1/xlog-data/{yyyymmdd}/{txid}
  - txid는 JSON에서 string으로 수신 → BigInt 변환
```

**오프셋 상태 관리:**
```typescript
interface XLogPollState {
  xlogLoop: number;    // 최초 0, 이후 응답에서 갱신
  xlogIndex: number;   // 최초 0, 이후 응답에서 갱신
}

// 폴링 흐름
1. useXLogRealTimeData가 2초 간격으로 GET /v1/xlog-data/realTime/{loop}/{index} 호출
2. 응답의 xlogLoop/xlogIndex를 pollState에 저장 (다음 요청에 사용)
3. 수신된 xlogs[]를 XLogDataStore에 추가
4. XLogDataStore는 시간 윈도우(기본 5분) 밖의 데이터를 자동 삭제
5. 새 데이터 추가 시 dirty flag를 true로 설정
6. useXLogCanvas의 rAF 루프가 dirty flag를 감지하면 XLogChartRenderer.render() 호출
7. 렌더링 완료 후 dirty flag를 false로 리셋
```

**txid 정밀도 주의:**
```typescript
// Java long(64bit) → JSON number 변환 시 정밀도 손실 발생
// Java Proxy가 txid를 string으로 반환하는지 반드시 확인 필요
// string이면: BigInt(response.txid)
// number이면: 53bit 초과 시 손실 — Java Proxy 수정 요청 또는 string 강제 직렬화 협의
const txid: bigint = BigInt(xlogs[i].txid as unknown as string);
```

---

## 6. 렌더링 시퀀스 (레이어 순서)

`XLogChartRenderer.render()` 내부에서 다음 순서로 캔버스에 드로잉한다. 원본 `XLogViewPainter.java`의 `draw()` 메서드 구조를 충실히 따른다.

```
렌더링 순서 (뒤에서 앞으로):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1단계: 배경 (Background)
  └─ ctx.fillRect()로 전체 캔버스를 배경색으로 채움

2단계: 무시 영역 (Ignore Area)
  └─ ignoreThresholdMs 이하 영역을 반투명 회색으로 표시
  └─ 개발자가 관심 없는 빠른 응답 구간을 시각적으로 구분

3단계: Y축 그리드 (Y Grid Lines)
  └─ GridCalculator로 계산된 수평선 + 좌측 레이블
  └─ ctx.strokeStyle = gridColor, ctx.setLineDash([2, 2])

4단계: X축 그리드 (X Grid Lines)
  └─ GridCalculator로 계산된 수직선 + 하단 시간 레이블
  └─ 시간 포맷: "HH:mm:ss" (5초 간격 이상이면 "HH:mm")

5단계: 데이터 점 (Data Points) ★ 핵심
  └─ SXLog 배열을 순회하며:
     a. CoordinateMapper로 (endTime, elapsed) → (px, py) 변환
     b. XLogFilterState로 필터링 체크
     c. PointMap으로 충돌 체크 (이미 그려진 위치면 스킵)
     d. DotImageCache에서 색상별 5x5 비트맵 가져옴
     e. ctx.drawImage(dotBitmap, px-2, py-2) 블리팅
     f. PointMap에 해당 위치 등록

6단계: 테두리 (Border)
  └─ 플롯 영역 외곽선 드로잉
  └─ ctx.strokeRect(plotArea)

7단계: 메타데이터 (Metadata Overlay)
  └─ 좌상단: 현재 표시 중인 점 개수 ("12,345 dots")
  └─ 우상단: Y축 모드 표시 ("Elapsed(ms)")
  └─ 드래그 선택 영역이 있으면 반투명 사각형 오버레이
```

---

## 7. 인터랙션 설계

### 7.1 드래그 선택 (Drag Select)

```
마우스 왼쪽 버튼 드래그:
1. mousedown → 선택 시작점 기록
2. mousemove → 선택 영역 사각형을 반투명 파란색으로 오버레이
3. mouseup → 선택 영역 내의 점들을 PointMap.queryRect()로 추출
4. 선택된 XLog 목록을 콜백으로 상위 컴포넌트에 전달
5. 선택된 점들은 하이라이트 색상으로 재렌더링
```

### 7.2 Shift + 드래그 줌 (Zoom)

```
Shift 키 + 마우스 왼쪽 버튼 드래그:
1. Shift+mousedown → 줌 시작점 기록
2. mousemove → 줌 영역 사각형을 반투명 녹색으로 오버레이
3. mouseup → 줌 영역의 데이터 좌표를 CoordinateMapper로 역변환
4. XLogChartConfig의 timeRangeMs, yMax를 줌 영역에 맞게 갱신
5. 줌 히스토리 스택에 이전 설정 push (줌 아웃용)
```

### 7.3 키보드 팬/스케일

```
키보드 단축키:
- ←/→ 화살표: X축(시간) 팬 (timeRangeMs의 10%씩 이동)
- ↑/↓ 화살표: Y축 스케일 조정 (yMax를 20%씩 증감)
- Home: 실시간 모드로 복귀 (현재 시각 기준)
- Escape: 줌 초기화 (히스토리 스택 전체 팝)
- Ctrl+A: 화면 내 전체 점 선택
```

### 7.4 마우스 호버 (Tooltip)

```
마우스 이동 시:
1. mousemove → PointMap.has(x, y)로 해당 픽셀에 점 존재 여부 O(1) 확인
2. 점이 있으면 해당 XLog 데이터 조회
3. XLogTooltip 컴포넌트에 위치와 데이터 전달
4. 50ms 디바운스로 과도한 업데이트 방지
```

---

## 8. 성능 최적화 전략

### 8.1 비트맵 충돌 감지 — O(1)

| 방식 | 50,000점 기준 충돌 체크 | 메모리 |
|------|------------------------|--------|
| 배열 순회 | O(n) = ~50,000회 비교 | 낮음 |
| **Uint8Array PointMap** | **O(1)** = 인덱스 직접 접근 | 1920x1080 = ~2MB |
| QuadTree | O(log n) | 중간 |

PointMap 채택 이유: XLog 렌더링은 동일 위치 중복 체크가 빈번하므로 O(1) 접근이 결정적 이점.

### 8.2 점 이미지 캐시 (DotImageCache)

```
drawImage() vs fillRect() 비교 (50,000점 기준):
- fillRect() 50,000회: ~12ms
- arc() + fill() 50,000회: ~25ms
- drawImage(cached 5x5) 50,000회: ~4ms  ★ 채택

ImageBitmap은 GPU 텍스처로 미리 업로드되므로 블리팅이 매우 빠름.
색상 종류가 제한적이므로 (보통 10~30종) 캐시 메모리 부담 미미.
```

### 8.3 필터 해시 캐시

```
필터 조건이 변경되지 않으면 필터링 결과를 재계산하지 않음.
- XLogFilterState를 JSON.stringify()한 해시값 비교
- 해시 동일 → 이전 필터링 결과 재사용
- 해시 변경 → 전체 재필터링 후 캐시 갱신
```

### 8.4 requestAnimationFrame + dirty flag

```
렌더링 루프 의사코드:

function frameLoop() {
  requestAnimationFrame(frameLoop);

  if (!dirty) return;  // 변경 없으면 렌더링 스킵

  renderer.render(store.getData(), filter, Date.now());
  dirty = false;
}

dirty flag가 true가 되는 조건:
- 새 XLog 데이터 도착 (2초 폴링)
- 필터 조건 변경
- Y축 모드 변경
- 캔버스 리사이즈
- 줌/팬 조작
- 드래그 선택 진행 중
```

### 8.5 50ms 스로틀

```
마우스 이동 이벤트(hover tooltip)에 50ms 스로틀 적용:
- 마우스 이동은 초당 60~120회 발생 가능
- PointMap 조회 자체는 O(1)이지만 React 상태 업데이트 비용 절감
- lodash.throttle 또는 직접 구현한 throttle 사용
```

### 8.6 성능 목표치

| 지표 | 목표 | 비고 |
|------|------|------|
| 렌더링 프레임 시간 | < 16ms (60fps) | 50,000점 기준 |
| 데이터 추가 | < 2ms | 2초마다 ~1,000건 |
| 필터 적용 | < 5ms | 50,000건 전체 필터링 |
| 메모리 사용 | < 50MB | 100,000건 유지 기준 |
| 첫 렌더링 | < 100ms | 빈 차트 초기 표시 |

---

## 9. 구현 단계 (Phase)

### Phase 1: 타입 및 엔진 기초 (types + engine)

**목표:** 렌더링 파이프라인의 순수 로직 계층 완성

```
1-1. types/ 전체 인터페이스 정의
     - SXLog, XLogRenderItem, YAxisMode, XLogChartConfig, ChartLayout, XLogFilterState

1-2. engine/GridCalculator.ts
     - ChartUtil.java의 nice number 알고리즘 포팅
     - 단위 테스트 작성

1-3. engine/CoordinateMapper.ts
     - 데이터 ↔ 픽셀 양방향 변환
     - 단위 테스트 작성

1-4. engine/PointMap.ts
     - Uint8Array 기반 충돌 감지
     - 벤치마크 테스트 (50,000점 기준)

1-5. engine/DotImageCache.ts
     - OffscreenCanvas 기반 ImageBitmap 생성/캐시
```

### Phase 2: 메인 렌더러 (engine/XLogChartRenderer.ts)

**목표:** Canvas에 정적 데이터를 올바른 레이어 순서로 렌더링

```
2-1. XLogChartRenderer 클래스 구현
     - 7단계 렌더링 시퀀스 구현
     - 하드코딩된 테스트 데이터로 시각적 검증

2-2. 렌더링 정확성 검증
     - 그리드 레이블 위치/포맷 확인
     - 점 위치 정확성 확인 (알려진 좌표 세트로 검증)
     - 무시 영역 표시 확인
```

### Phase 3: 데이터 레이어 (store + api + hooks)

**목표:** Java Proxy와 통신하여 실시간 데이터를 스토어에 축적

```
3-1. api/xlogApi.ts
     - REST API 통신 구현 (/xlog/realtime 엔드포인트)
     - 응답 타입 검증 및 SXLog 변환

3-2. store/XLogDataStore.ts
     - 시간 윈도우 기반 데이터 관리
     - 만료 데이터 자동 삭제 로직
     - dirty flag 관리

3-3. hooks/useXLogRealTimeData.ts
     - 2초 폴링 로직
     - 에러 재시도 (최대 3회, exponential backoff)
     - 컴포넌트 언마운트 시 정리
```

### Phase 4: React 통합 (hooks + components)

**목표:** Canvas 렌더러를 React 컴포넌트로 래핑하여 화면에 표시

```
4-1. hooks/useXLogCanvas.ts
     - Canvas ref 관리
     - rAF 루프 + dirty flag 연동
     - ResizeObserver로 캔버스 크기 자동 조정

4-2. components/XLogChart.tsx
     - Canvas 엘리먼트 래핑
     - useXLogCanvas, useXLogRealTimeData 조합
     - React.memo 적용

4-3. components/XLogToolbar.tsx
     - Y축 모드 전환 UI
     - 필터 입력 UI
     - 실시간/정지 토글
```

### Phase 5: 인터랙션 및 부가 기능 (extras)

**목표:** 드래그 선택, 줌, 키보드 단축키, 툴팁 등 사용자 인터랙션 완성

```
5-1. hooks/useXLogInteraction.ts
     - 드래그 선택 (mousedown → mousemove → mouseup)
     - Shift+드래그 줌
     - 키보드 팬/스케일
     - 줌 히스토리 스택

5-2. components/XLogTooltip.tsx
     - 호버 시 트랜잭션 상세 팝업
     - 50ms 스로틀 적용

5-3. 선택된 XLog 목록 → 트랜잭션 상세 뷰 연동
     - 선택 콜백 인터페이스 설계
     - 상위 컴포넌트 연동
```

---

## 10. 참고: 원본 Java 코드 매핑

| 원본 Java | 포팅 대상 TypeScript | 비고 |
|-----------|---------------------|------|
| `XLogViewPainter.java` | `XLogChartRenderer.ts` | 메인 렌더러 |
| `ChartUtil.java` | `GridCalculator.ts` | 그리드 계산 |
| `XLogData.java` | `types/xlog.ts` (SXLog) | 데이터 모델 |
| `XLogViewMouse.java` | `useXLogInteraction.ts` | 마우스 이벤트 |
| `ImageCache.createXPImage6()` | `DotImageCache` + `drawDot()` | dot 패턴 렌더링 |
| `XLogFilterStatus.java` | `types/filter.ts` (XLogFilterState) | 필터 상태 |
| `XLogYAxisEnum.java` | `Y_AXIS_MODE_CONFIGS` 상수 | Y축 모드 설정 |
| `LongKeyLinkedMap<XLogData>` | `Map<bigint, SXLog>` | 삽입 순서 보장 데이터 저장소 |
| `AgentColorManager` | `getAgentColor(objHash)` | objHash 기반 팔레트 |
| SWT `GC` API | Canvas 2D API (`CanvasRenderingContext2D`) | 드로잉 API |
| SWT `Color` | CSS 색상 문자열 (`#RRGGBB`) | 색상 체계 |
| `pointMap` (int[][]) | `PointMap.ts` (Uint8Array) | 충돌 감지 |
| `TcpProxy.TRANX_REAL_TIME_GROUP` | `GET /v1/xlog-data/realTime/{loop}/{index}` | 실시간 XLog 폴링 |
| `TcpProxy.TRANX_LOAD_TIME_GROUP_V2` | `GET /v1/xlog-data/{yyyymmdd}` | 이력 XLog 페이징 |
| `TcpProxy.XLOG_READ_BY_TXID` | `GET /v1/xlog-data/{yyyymmdd}/{txid}` | 단건 XLog 조회 |
| `TcpProxy.XLOG_READ_BY_GXID` | `GET /v1/xlog-data/{yyyymmdd}/gxid/{gxid}` | GXID 기반 조회 |

---

## 11. ASIS 분석 기반 구현 주의사항

ASIS 소스 분석(`07-client-xlog.md`, `04-webapp-rest-api.md`, `05-webapp-service-layer.md`)에서 확인된 버그 및 엣지케이스. TO-BE 구현 시 반드시 반영해야 한다.

### 11.1 txid / gxid 정밀도 손실 (Critical)

Java `long`(64bit)을 JSON `number`로 직렬화하면 53bit 초과 값에서 정밀도 손실이 발생한다.

```typescript
// 잘못된 방식 — txid가 2^53 초과 시 손실
const txid: number = response.txid;

// 올바른 방식 — Java Proxy가 string으로 직렬화하는 경우
const txid: bigint = BigInt(response.txid);

// Java Proxy 응답 확인 필수:
// - txid가 JSON number로 오면 → Java Proxy 측 string 직렬화 요청
// - txid가 JSON string으로 오면 → BigInt(str) 변환
```

`Map<bigint, SXLog>`를 사용하면 키 타입이 bigint이므로 JSON 키로 직렬화 시 `toString()` 처리 필요.

### 11.2 오프셋 기반 폴링 — loop/index 초기화 타이밍

```typescript
// 뷰 마운트 시 오프셋을 0으로 초기화 (서버의 최신 위치부터 수신)
// ASIS: XLogConsumer.handleRealTimeXLog() — loop=0, index=0이면 최신 데이터 요청
const [pollState, setPollState] = useState<XLogPollState>({ xlogLoop: 0, xlogIndex: 0 });

// 주의: 컴포넌트 언마운트 후 재마운트 시 오프셋을 0으로 리셋해야 함
// 이전 오프셋을 유지하면 마운트 간 누락된 데이터를 요청하게 됨 (의도한 동작인지 확인 필요)
```

### 11.3 Y축 범위 초과 점 처리 (클리핑)

ASIS: `yValueMax` 이상인 점은 `value = -1` 처리 → `y = chart_h - 1`(차트 상단 고정).

```typescript
// TO-BE 구현 시 동일하게 처리
function calcYPixel(value: number, yMax: number, plotH: number): number {
  if (value >= yMax) return 0;         // 차트 상단에 고정 (plotArea 기준)
  if (value < 0) return plotH;         // 차트 하단
  return plotH - Math.floor(plotH * value / yMax);
}
// 클리핑된 점은 PointMap에서 같은 y=0 라인에 몰려 충돌할 수 있음 → 의도된 동작
```

### 11.4 날짜 경계(자정) 이력 조회

자정을 걸치는 시간 범위(예: 23:50 ~ 00:10)는 날짜별로 분리하여 두 번 요청해야 한다.

```typescript
function buildXLogDateRequests(startMs: number, endMs: number): Array<{date: string, startMs: number, endMs: number}> {
  const startDate = toYYYYMMDD(startMs);
  const endDate = toYYYYMMDD(endMs);
  if (startDate === endDate) return [{ date: startDate, startMs, endMs }];
  // 자정 경계: 첫째 날 23:59:59.999까지 + 둘째 날 00:00:00부터
  const midnight = getStartOfDay(endMs);
  return [
    { date: startDate, startMs, endMs: midnight - 1 },
    { date: endDate, startMs: midnight, endMs },
  ];
}
```

### 11.5 드래그 선택 모드 구분

ASIS에서 마우스 드래그는 두 가지 모드로 동작한다. `mouseDown` 시점에 Shift 키 여부로 분기:

| 조건 | 모드 | 색상 | mouseUp 동작 |
|------|------|------|-------------|
| 일반 드래그 | `LIST_XLOG` | 파란색 반투명 | 영역 내 XLogData 목록 조회 콜백 |
| Shift + 드래그 | `ZOOM_AREA` | 빨간색 반투명 | 해당 영역으로 차트 줌인 |

단순 클릭(`mouseDown` → `mouseUp`, 드래그 없음)도 선택 처리 로직을 거치지만 `inRect` 조건(`lx < sx` 엄격 부등호)에 의해 결과가 빈 배열로 반환되어 실질적으로 무해하다.

### 11.6 필터 해시 XOR 충돌 방지

ASIS의 `XLogFilterStatus.hashCode()`는 XOR 기반으로 동일한 두 값이 있으면 해시가 0이 되어 "필터 없음" 상태와 구분이 안 된다.

TO-BE에서는 JSON.stringify 기반 해시를 사용한다:

```typescript
// 필터 변경 감지 — XOR 충돌 없음
const filterKey = JSON.stringify(filterState);
const prevFilterKeyRef = useRef<string>('');

// filterKey가 변경되었을 때만 전체 재필터링
if (filterKey !== prevFilterKeyRef.current) {
  prevFilterKeyRef.current = filterKey;
  dirtyRef.current = true;
}
```

### 11.7 XLogLoopCache 딕셔너리 지연

`/v1/xlog-data/realTime` 엔드포인트는 내부적으로 딕셔너리 로드를 최대 2초 대기한다. 2초 내에 로드되지 않으면 `service`, `threadName` 등 텍스트 필드가 빈 문자열로 반환될 수 있다.

```typescript
// 빈 문자열 방어 처리
const serviceName = xlog.service || `[hash:${xlog.objHash}]`;
```
