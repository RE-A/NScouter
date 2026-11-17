# 작업 공간(판) 설계 — 원본 스카우터의 흐름으로

> 상태: **설계안 (구현 전)** · 2026-11-17
> 근거: 사용자 피드백(원본과 사용성이 달라 적응이 힘들다 · 글자가 작다 · 여러 XLog 를 한 화면에) 과
> 원본 클라이언트 소스 `scouter-project/scouter` `scouter.client` (커밋 `14dcf26`).

---

## 1. 왜 바꾸나

피드백의 뿌리는 화면 하나하나가 아니라 **구조 차이**다.

| | 원본 스카우터 | 지금 NScouter |
|---|---|---|
| 화면의 대상 | **화면마다** 콜렉터×종류(또는 에이전트 하나)가 박힌다 | 왼쪽 목록 하나를 모든 화면이 같이 쓴다 (XLog 만 탭마다) |
| 화면 여는 길 | Objects 트리 **오른쪽 클릭 → 메뉴** | 위쪽 탭(XLog/Active/Visualize/Counter/Alert/통계) |
| 한 화면에 | XLog·EQ·카운터·Alert 를 끌어 붙여 **동시에** | 탭 하나씩. XLog 끼리만 4판 |
| 시작 화면 | 짜인 대시보드 (왼쪽 열·카운터 4개·XLog) | XLog 탭 하나 |

탭이 나뉜 것은 «대상을 화면 전체가 하나로 공유한다» 는 데이터 구조의 결과다. 그래서 판 나누기만 넓혀서는
안 되고, **화면이 저마다 대상을 갖게** 하는 것이 먼저다. XLog 는 이미 탭마다 서버를 고르므로 절반 와 있다.

## 2. 원본에서 화면을 여는 과정 (소스로 확인한 것)

1. **기본 배치** (`PerspectiveService.java`) — 왼쪽 열 Objects / Alert / Active Service EQ / Host CPU,
   가운데 열 Recent User · TPS · Elapsed Time · Heap Used, 오른쪽 XLog. 기본 호스트·WAS 종류는 설정값.
2. **Objects 트리** — `콜렉터 → 오브젝트 종류 → 에이전트`.
3. **오른쪽 클릭 메뉴** (`ObjectNavigationView.fillMenu`, `MenuUtil`)
   - 콜렉터: 종류별 하위 메뉴 — 그 종류의 카운터 전부 + 특수 메뉴(Heap Memory, EQ, Vertical EQ,
     Active Service List, Active Speed, **XLog**, Service Count, Service Group TPS/Elapsed, Unique Visitor,
     Summary, File Descriptor). 그 밖에 Total Summary, Alert Detail List, 설정
   - 종류: 그 종류의 카운터 목록
   - 에이전트: Performance Counter(그 에이전트 하나), Performance Snapshot(Thread List, Active Service List,
     Class List, Heap Histogram, Thread Dump, Env, Socket, GC …), Stack Analyzer, Configure, 색, Properties
4. **대상이 박힌 화면** — 화면 ID 에 `콜렉터ID&종류` 를 붙여 연다. 같은 대상이면 있던 화면이 앞으로,
   다르면 새 화면. 제목 `XLog - PRD-FSCPS`, 부제 `ⓢCJFW | PRD-FSCPS's XLog Realtime`.
5. **배치** — 새 화면은 정해진 자리에 뜨고, 제목 탭을 끌어 붙인다. 배치는 작업 공간에 남는다.
6. **좁히기** — 트리에서 에이전트를 더블클릭하면 그 에이전트만 남기는 **전역 필터**(트리 배경 하늘색).
   XLog·EQ·카운터가 모두 따른다. 다시 더블클릭 또는 `Clear Object Filter` 로 푼다.
7. **키** — 전역 단축키는 없다(`org.eclipse.ui.bindings` 가 비어 있다). XLog 차트 안에서만
   (`XLogViewPainter.keyPressed`): `↑`/`↓` Y축 최대(2초 이상이면 1초, 아래면 0.1초씩),
   `+`/`-` 시간 폭 1분씩, `←`/`→` 시간 10초씩 이동. 프로파일 창 `f` 찾기.

## 3. 원칙

**원본의 흐름을 뼈대로, 지금 앱이 고친 것은 그 위에 남긴다.**

| 원본에서 가져온다 | 지금 앱에서 남긴다 (원본보다 나은 것) |
|---|---|
| 트리 오른쪽 클릭으로 화면을 연다 | 서비스 묶기(ECS Task 를 서비스로) · 그룹 규칙 |
| 화면마다 대상이 박힌다 | 여러 콜렉터를 함께 붙이기(`hub`) |
| 끌어 붙이는 배치, 배치 저장 | 화면마다 실시간/과거·구간·거름 조건(지금 XLog 탭) |
| 원본과 같은 기본 배치 | 트랜잭션 찾기 · 통계 · 프로파일 검색 · 저장본 |
| 에이전트 더블클릭 = 전역 필터 | 새 창으로 떼기(모니터 여러 대) |
| XLog 키 `↑↓ +- ←→` | 지금 단축키(`Ctrl+F`, `F5`, `Ctrl+R` …) — 겹치면 원본 쪽 |
| 흰 바탕 · 읽히는 글자 | 보이는 판만 데이터를 받는다 |

## 4. 핵심 개념 — 판(Panel)

```ts
interface Panel {
  id: string;            // 바뀌지 않는다
  kind: PanelKind;       // 무엇을 그리나
  target: Target;        // 무엇을 보나 — 판마다
  view?: PanelView;      // 판마다의 조건 (XLog: 모드·구간·차트 설정·거름 = 지금 XLogTab 의 나머지)
  title?: string;        // 사람이 붙인 이름. 없으면 kind + target 에서 만든다
}

type Target =
  | { by: 'type'; collector: string; objType: string }      // 원본의 기본 단위
  | { by: 'selection'; selection: GroupSelection }          // 지금 앱의 고르기(서비스 묶음·낱개 Task)
  | { by: 'agent'; collector: string; objName: string };    // 에이전트 하나 (이름으로 — 해시는 갈린다)
```

- `selection` 은 지금 `XLogTab.selection` 그대로다 — 이름으로 들고 해시는 명단이 바뀔 때마다 푼다
  (`groupSelection.ts`). `type`·`agent` 도 같은 방식으로 푼다.
- 콜렉터는 이름으로 든다. 하나만 붙어 있으면 화면에 드러내지 않는다.

### PanelKind (1차)

| kind | 지금 컴포넌트 | 원본 대응 |
|---|---|---|
| `xlog` | `XLogChart` + 툴바 | XLog Realtime |
| `counter` (카운터 이름) | `CounterChart` | Counter RealTime All/Total |
| `eq` | `ActiveServicePanel` | Active Service EQ |
| `activeList` | `ActiveTab` 목록 | Active Service List |
| `alert` | `AlertFullView` | Alert |
| `summary` | `SummaryPanel` | Summary |
| `serviceGroup` | `ServiceGroupPanel` | Service Group TPS/Elapsed |
| `topology` | `TopologyPanel` | (원본 없음) |
| `fiveMin` | `FiveMinCounterChart` | Today/Past 카운터 |
| `txList` | 트랜잭션 목록 + 상세 | XLog 선택 목록 |
| `visualize`, `stats` | 지금 탭 | (원본 없음) |

`Objects 트리` 는 판이 아니라 왼쪽에 고정한다(원본도 닫을 수 없다).

## 5. 배치 — 도킹

- **배치 = 나눔(가로/세로, 몫) 과 판 묶음(탭 여러 개) 의 나무.** 판 묶음 안에서는 탭으로 오간다.
- 판 제목 탭을 끌어 다른 판의 **가장자리**에 놓으면 그 옆에 서고, **가운데**에 놓으면 그 묶음의 탭이 된다.
  지금 `XLogSplit` 의 손버릇(`dropSideAt`, 가장자리 1/4) 을 그대로 넓힌다.
- 판 수 제한: 지금 4 → 넉넉히(예: 16). 판이 엽서만 해지는 것은 사용자가 정할 일이다.
- **창 밖으로 끌면 새 창** — 지금 XLog 떼기(`detached/`)를 모든 판으로 넓힌다. 창마다 배치 나무를 한 벌 든다.
- 배치는 `config.json` 에 남긴다(지금 `xlog_tabs` · `xlog_split` · `xlog_windows` 를 대신한다).
- 직접 만드느냐 라이브러리(도킹 배치용 React 라이브러리)냐는 **P1 에서 붙여 보고** 정한다. 기준:
  판을 다시 세우지 않고 옮길 수 있나(차트가 받아 둔 점을 잃지 않게 — 지금 `XLogSplit` 이 자리만 바꾸는 이유),
  새 창 떼기와 맞물리나, 크기, 테마 토큰을 먹나.

## 6. 여는 길

1. **트리 오른쪽 클릭** — 원본 메뉴 구성을 따른다.

   | 누른 곳 | 메뉴 | 여는 판의 대상 |
   |---|---|---|
   | 콜렉터 | 종류별 하위 메뉴: 카운터들 · XLog · EQ · Active List · Summary · Service Group … / Alert | `type` |
   | 종류 · 서비스 묶음 | 카운터들 · XLog · EQ · Active List · Summary | `type` 또는 `selection` |
   | 에이전트 | 그 에이전트의 카운터들 · XLog · 스냅샷(Thread/Active/Class/Heap/Env/Socket…) · 설정 | `agent` |

   «서비스 묶음» 은 지금 앱의 묶기(서비스로 묶어 보기)일 때 나오는 노드다 — 원본에 없는 단위지만 같은 메뉴를 준다.
2. **같은 대상·같은 종류면 있던 판을 앞으로** — 원본과 같다. `Shift` 를 누르고 고르면 새 판.
3. **판 머리 메뉴** — 대상 바꾸기(트리에서 고른 것으로), 이름 바꾸기, 복제(지금 `+ 탭`), 새 창으로, 닫기.
4. **판이 없을 때 트리에서 끌어 놓기** — 종류·묶음·에이전트를 판 위로 끌면 그 대상의 XLog 판(기본).

## 7. 전역 필터 (에이전트 더블클릭)

- 트리에서 에이전트를 더블클릭하면 **모든 판에** «이 에이전트만» 이 걸린다. 다시 더블클릭·`필터 풀기`.
  트리 배경과 판 머리에 걸려 있음을 드러낸다(원본은 트리 배경만이라 놓치기 쉽다 — 개선).
- 판의 대상과 겹쳐 아무것도 안 남으면 판에 «전역 필터로 비었음» 을 적는다.

## 8. 데이터 — 보이는 판만 받는다

- **보이는 판** = 창에 떠 있고, 판 묶음에서 앞에 있는 탭. 접힌 탭·숨은 창은 받지 않는다.
- **XLog** — 지금 창마다 오브젝트를 알리면 Rust 가 합쳐 스트림 하나를 연다(`start_xlog_stream`,
  `xlog_subs`). 이것을 **판마다** 로 바꾼다(키를 창 라벨 → 판 id). 점은 판마다 제 대상만 그린다.
- **카운터** — 지금은 스트림이 하나다(`start_counter_stream` 이 토큰 하나 — 새로 열면 앞의 것이 멈춘다).
  한 번에 «오브젝트 묶음 × 카운터 목록» 한 벌만 받는다.
  XLog 와 같이 **판마다 구독(오브젝트 × 카운터 이름)을 알리고 Rust 가 합쳐** 콜렉터마다 2초 폴링 한 번,
  받은 것을 판마다 나눠 준다.
- **EQ · Active · Summary · Service Group** — 지금처럼 판이 보일 때만 묻는다(`enabled`). 같은 대상·같은
  주기의 판이 둘이면 한 번 물어 나눈다(P2 에서 겹침이 실제로 생기면).
- **Alert** — 지금처럼 앱 전체가 받는다(배지).

## 9. XLog 판 안

- 툴바(실시간/과거·구간·거름·트랜잭션 찾기)는 **판 머리 아래** 판마다 둔다 — 지금은 «지금 판» 하나의
  툴바를 위에 둔다. 좁은 판에서는 접는다.
- 드래그로 고른 트랜잭션은 **트랜잭션 목록 판(`txList`)** 으로 간다. 목록 판은 «마지막에 고른 XLog 판» 을 따른다
  — 지금의 «지금 판» 개념. 목록 판이 없으면 그 XLog 판 아래에 붙여 연다.
- 키: 원본의 `↑`/`↓`(Y축 최대) · `+`/`-`(시간 폭) · `←`/`→`(10초 이동) 을 차트에 넣는다.
  지금의 휠·Ctrl+휠은 남긴다.
- 제목: `XLog - {대상}`, 부제 `ⓢ{콜렉터} | {대상}'s XLog {Realtime|과거 구간}` — 원본과 같은 꼴.

## 10. 보기

- **흰 테마를 기본**으로. 저장된 설정이 있는 PC 는 이번 이행 때 한 번만 흰색으로 돌린다(되돌리기 안내).
- **캔버스 글자도 글자 크기 배율을 따른다.** 지금 축·건수 글자가 `9~11px` 고정이라 배율을 올려도 그대로다
  (`XLogChartRenderer` · `CounterChart` · `FiveMinCounterChart` · `StackedTimeline` · `StatsCharts`).
  기본을 12px 안팎으로, 축 글자 색 대비를 올린다. `Elapsed (sec)` · `Count` 를 원본처럼 또렷하게.

## 11. 기본 배치 (처음 붙었을 때)

원본 `PerspectiveService` 와 같게:

```
┌──────────┬──────────────┬─────────────────────────────┐
│ Objects  │ Recent User  │                             │
│ (고정)    ├──────────────┤                             │
├──────────┤ TPS          │   XLog - {기본 종류}           │
│ Alert    ├──────────────┤                             │
├──────────┤ Elapsed Time │                             │
│ EQ       ├──────────────┤                             │
├──────────┤ Heap Used    ├─────────────────────────────┤
│ CPU      │              │   트랜잭션 목록 (접힘)          │
└──────────┴──────────────┴─────────────────────────────┘
```

- 기본 종류: 설정값이 있으면 그것, 없으면 붙은 javaee 종류 중 오브젝트가 가장 많은 것.
- `기본 배치로` 단추로 언제든 돌아간다. 배치를 이름 붙여 저장·전환(원본의 퍼스펙티브) 은 P4.

## 12. 위쪽 탭은 어떻게

- XLog · Counter · Active · Alert 는 **판이 된다** → 위쪽 탭에서 빠진다.
- Visualize · 통계 는 화면 전체를 쓰는 «도구» 라 판으로도 열 수 있게 하되, 위쪽에 `작업 공간 | 통계 | Visualize`
  정도로 남긴다(정할 것 Q2).

## 13. 이행 · 호환

- 처음 켤 때 지금 설정(`xlog_tabs`·`xlog_split`·`xlog_windows`)을 판 배치로 옮긴다 — XLog 탭은 XLog 판,
  분할은 나눔, 뗀 창은 창. 옮긴 뒤 옛 키는 지운다.
- 옮길 것이 없으면 11장의 기본 배치.
- 지금 단축키는 그대로 두되 `Ctrl+1~6`(위쪽 탭) 은 «판 묶음 앞으로» 로 뜻을 바꾸거나 없앤다(Q4).

## 14. 단계

| 단계 | 내용 | 끝났다고 보는 것 |
|---|---|---|
| **P0 보기** | 흰 테마 기본, 캔버스 글자 배율·크기·대비 | 2번 이미지의 시간·건수가 읽힌다 |
| **P1 판 뼈대** | 판 모델·도킹 배치(먼저 XLog 판만), 이행, 저장 | 지금 XLog 탭·분할·떼기가 판으로 그대로 된다 |
| **P2 판 넓히기** | counter·eq·activeList·alert·summary·serviceGroup 판, 판마다 구독(Rust 카운터 스트림 합치기) | 서로 다른 대상의 XLog·EQ·카운터가 한 화면에 |
| **P3 원본 손버릇** | 트리 오른쪽 클릭 메뉴, 같은 대상이면 있던 판, 에이전트 더블클릭 전역 필터, XLog 키 | 원본 사용자가 설명 없이 연다 |
| **P4 마무리** | 기본 배치, 배치 이름 붙여 저장, 판 새 창 떼기 일반화, 위쪽 탭 정리 | 처음 붙으면 원본과 같은 화면 |

P0 은 다른 단계와 상관없이 먼저 낼 수 있다.

## 15. 정할 것

1. **콜렉터를 드러낼까** — 여러 콜렉터를 «한 서버처럼» 합쳐 보이는 지금 방식(`hub`) 과 원본의 «콜렉터별 트리»
   중. 제안: 트리 맨 위를 콜렉터로 나누되(원본), 판 대상은 여러 콜렉터를 아우를 수 있게(`selection`).
2. **위쪽 탭** — Visualize·통계를 위쪽에 남길까, 판으로만 열까.
3. **도킹** — 직접 넓히기(`XLogSplit`) vs 라이브러리. P1 에서 둘 다 붙여 보고 고른다.
4. **`Ctrl+1~6`** — 뜻을 바꿀까, 없앨까.
5. **원본에 있고 지금 없는 화면** — Active Speed, Vertical EQ, Heap Histogram 판, Unique Visitor, Service Count …
   P2 범위에 넣을지, 쓰는 것만 고를지(사용자에게 물어 고른다).

## 16. 위험

- **App.tsx 가 3,600줄이고 상태가 «지금 판» 하나를 전제로 얽혀 있다.** P1 은 상태를 판 단위로 떼어 내는 일이
  대부분이다. 기능을 한 번에 옮기지 말고 XLog 판부터 동등하게 만든 뒤 넓힌다.
- 판이 많으면 폴링이 는다 — 판마다 구독을 합쳐 콜렉터당 요청 수를 지금과 같게 유지한다(8장).
- 원본과 «비슷하게» 의 기준이 사람마다 다르다 — P0·P1 이 끝날 때마다 실사용자에게 보인다.
