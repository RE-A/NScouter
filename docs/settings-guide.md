# 설정 가이드 (간략)

> NScouter 화면에 **무언가가 안 보이거나 이상할 때** 바꿀 설정을 증상별로 모았다.
> 왜 그런지·근거·주의점은 [상세 설명](settings-reference.md)에, 앱 자체 설정은 [사용자 가이드 §8](user-guide.md#8-설정-) 에 있다.
>
> 표기 — **[콜]** 콜렉터 설정 · **[에]** 자바 에이전트 설정 · **[앱]** 모니터링 대상 애플리케이션 · **[JVM]** JVM 옵션

---

## 0. 설정 바꾸는 법

| 무엇 | 어디서 |
|---|---|
| 콜렉터 설정 | 헤더 «콜렉터 설정» |
| 에이전트 설정 | 왼쪽 서버 목록 우클릭 → «설정» |
| 애플리케이션 · JVM 옵션 | 앱 쪽에서 직접 (재시작 필요) |

> **저장은 설정 파일을 통째로 덮어쓴다.** 저장 전 «바뀌는 항목» 목록을 꼭 확인한다.
> 재시작 없이 적용되는지는 항목마다 다르다 — 확인한 것만 [상세](settings-reference.md#적용-시점)에 적었다.

---

## 1. XLog (스캐터)

| 증상 | 바꿀 설정 |
|---|---|
| 빠른 트랜잭션이 안 보인다 · 스캐터가 비어 보인다 | [콜] `xlog_realtime_lower_bound_ms` · `xlog_pasttime_lower_bound_ms` 를 `0` 으로 · [에] `xlog_sampling_enabled=false` |
| 특정 서비스가 스캐터에만 없고 TPS 에는 잡힌다 | [에] `xlog_discard_service_patterns` 에 걸려 있는지 |
| 응답이 500 인데 빨간 점이 아니다 | 설정 문제가 아니다 — 프레임워크가 처리한 예외는 에러로 안 남는다 ([상세](settings-reference.md#13-빨간-점이-안-생긴다)) |
| 과거 조회가 **에러 없이 0건** · 새벽 시간대만 이상하다 | 콜렉터 서버와 이 PC 의 **타임존**을 맞춘다 |
| 차트 오른쪽이 비거나 점이 창 밖으로 밀린다 (시각 차이 배지) | 콜렉터·에이전트 서버와 이 PC 의 **시계**를 맞춘다 |

## 2. 프로파일 (상세 패널)

| 증상 | 바꿀 설정 |
|---|---|
| SQL 스텝이 하나도 안 남는다 | DB 드라이버가 기본 후킹 대상인지 확인 → 아니면 [에] `hook_jdbc_pstmt_classes` · `hook_jdbc_stmt_classes` · `hook_jdbc_rs_classes` |
| SQL 에 `@{1}` 같은 자리가 보인다 | 정상이다(값은 채워 보여준다). 원문 리터럴 그대로 받으려면 [에] `profile_sql_escape_enabled=false` |
| 바인드 값이 중간에 잘린다 | [에] `trace_sql_parameter_max_length` (기본 20, 최대 500) |
| 프로시저 OUT 파라미터 값이 `?` 로 남는다 | 설정으로 안 된다 — 에이전트가 기록하지 않는다 |
| SQL 본문 자리에 «에이전트가 SQL 문장을 받지 못했습니다» | 설정으로 안 된다 — 자동 생성 키를 돌려받는 INSERT 는 문장이 안 온다 |
| 여러 서버를 거친 호출이 흐름 보기에서 안 이어진다 | [에] `trace_interservice_enabled` 가 `true` 인지 (기본 `true`) |

## 3. Active 탭 (실행 중 트랜잭션)

| 증상 | 먼저 확인 | 바꿀 설정 |
|---|---|---|
| 갱신마다 떴다 사라졌다 · «연결을 못 얻어 못 물어본 서버» | 콜렉터 로그에 `[S501] Cannot find a tcp agent` | [콜] `net_tcp_get_agent_connection_wait_ms` ↑ · [에] `net_collector_tcp_session_count` ↑ |
| 갱신마다 떴다 사라졌다 · «콜렉터가 비활성으로 보는 서버» · 왼쪽 목록의 살아 있음 표시도 깜빡인다 | 하트비트는 **UDP 6100** 으로 간다 — 방화벽·보안그룹·NAT·MTU 로 유실되는지 | [콜] `object_deadtime_ms` ↑ (기본 8초). 근본은 UDP 유실을 없애는 것 |
| 어떤 서버의 서비스가 한 번도 안 뜬다 | ① 그 서버에 S501 이 계속 찍히나 ② 위쪽에 «콜렉터가 비활성으로 보는 서버» 로 나오나 | ① 위와 같음 ② 하트비트(UDP) |
| 짧은 쿼리가 거의 안 보인다 | — | **정상이다.** 순간 스냅샷이라 2초 안에 끝나는 것은 안 잡힌다. 그 사이에 몇 건이 지나갔는지는 위의 «실시간 트래픽» 점으로 본다 |

## 4. Counter · Visualize · 토폴로지

| 증상 | 바꿀 설정 |
|---|---|
| 커넥션 풀이 안 잡힌다 | [앱] `spring.datasource.hikari.register-mbeans=true` **와** [에] `jmx_counter_enabled=true` — 둘 다. (고른 WAS 아래 풀은 따로 고르지 않아도 값이 온다) |
| 토폴로지(서버 간 호출)가 비어 있다 | [에] `counter_interaction_enabled=true` |
| `PermPercent` 만 안 온다 (`PermUsed` 는 옴) | [JVM] `-XX:MaxMetaspaceSize=<크기>` |
| `ProcCpu` 가 안 온다 | 설정으로 안 된다 — 에이전트가 보내지 않는다 |
| 호스트 SYN_SENT·SYN_RECEIVE 가 실시간에 없다 | 정상이다 — 5분 집계에만 온다 |
| 호스트 Net/Disk Bytes 4종이 안 온다 | 설정으로 안 된다 — 에이전트(2.21.3)가 보내지 않는다 |

## 5. 서버 목록 · 종류

| 증상 | 바꿀 설정 |
|---|---|
| 서버가 **WAS 로 안 잡힌다** (Active 탭·애플리케이션 카운터에 없음) | 커스텀 종류(`monitoring_group_type=ORDER-JVM`)도 콜렉터가 아는 Family 로 가른다 (0.5.3 까지는 못 갈랐다). 그래도 안 잡히면 콜렉터의 사이트 정의(`counters.site.xml`)에 그 종류가 `javaee` 로 들어 있는지 본다 |
| 방문자 옆에 «종류별 합» 이라고 붙는다 | 정상이다. 종류마다 센 고유 사용자 수를 더한 것이라 **같은 사용자가 겹칠 수 있다** |
| 개발·운영 서버 이름이 같아 헷갈린다 | [에] `obj_name` 을 환경별로 다르게 |

## 6. 과거 조회 · 넓은 검색

| 증상 | 바꿀 설정 |
|---|---|
| 넓은 검색 결과가 **딱 500건** | [콜] `req_search_xlog_max_count` — 500 은 «전부» 가 아니라 «잘림» 일 수 있다 |
| 며칠 지난 프로파일이 안 열린다 | [콜] `mgr_purge_profile_keep_days` (기본 10일) · `mgr_purge_xlog_keep_days` (30일) · `mgr_purge_disk_usage_pct` (80%) |

## 7. 오브젝트 작업 (덤프)

| 증상 | 바꿀 것 |
|---|---|
| 스레드 덤프·힙 히스토그램 파일 크기가 0 | 앱을 **JRE 가 아니라 JDK** 로 실행 (`jdk.attach` 모듈 필요) + [JVM] `-Djdk.attach.allowAttachSelf=true` |

## 8. 콜렉터 운영

| 증상 | 바꿀 것 |
|---|---|
| JDK 11 이상에서 콜렉터가 안 뜬다 (`ExceptionInInitializerError`) | [JVM] `--add-opens=java.base/java.lang=ALL-UNNAMED --add-exports=java.base/sun.net=ALL-UNNAMED` |
| 방화벽에서 무엇을 열어야 하나 | TCP 6100 (NScouter·에이전트) · UDP 6100 (에이전트 지표) |
| 로그가 어디 있나 | `log_dir`(기본 `./logs`) 아래 `server-yyyyMMdd.log` |

## 9. NScouter 앱

| 무엇 | 어디 |
|---|---|
| 차트에 «버퍼 상한 … 오래된 점부터 지웁니다» | ⚙ 설정 → XLog 버퍼 상한 (기본 100,000) |
| 바인드 값을 문장에 채울지 따로 볼지 | ⚙ 설정 → SQL 바인딩 파라미터 |
| 비밀번호 저장 | «자동 연결» 을 켠 서버만, **config.json 에 평문** — 공용 PC 에서는 끈다 |

자세한 것은 [사용자 가이드 §8](user-guide.md#8-설정-).
