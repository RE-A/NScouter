// 영어 사전 (한국어 원문 → 영어)
//
// 키가 곧 한국어 화면 문구다. 여기 없으면 한국어가 그대로 나온다 — 빠진 자리가
// 고장으로 보이지 않게 하려는 것이다 (i18n/index.ts 참고).
//
// **Scouter 용어는 원래 영어다.** TPS·XLog·Elapsed 처럼 원본이 영어인 말은
// 한국어 화면에서도 그대로 쓰고 있어 여기 없다.

export const EN: Record<string, string> = {
  // ── 공통 ──────────────────────────────────────────────
  '전체': 'All',
  '이름': 'Name',
  '값': 'Value',
  '키': 'Key',
  '내용': 'Content',
  '상태': 'State',
  '시간': 'Time',
  '서버': 'Server',
  '건': '',
  '개수': 'Count',
  '횟수': 'Count',
  '합계': 'Total',
  '평균': 'Avg',
  '합계(ms)': 'Total(ms)',
  '평균(ms)': 'Avg(ms)',
  '비중': 'Share',
  '에러': 'Error',
  '레벨': 'Level',
  '메시지': 'Message',
  '제목 / 메시지': 'Title / Message',
  '출처': 'Source',
  '열기': 'Open',
  '닫기': 'Close',
  '검색': 'Search',
  '취소': 'Cancel',
  '설정': 'Settings',
  '초': 'sec',
  '바이트': 'bytes',
  '(비어 있음)': '(empty)',
  '조회 중…': 'Loading…',
  '다시 조회': 'Reload',
  '항목이 없습니다.': 'Nothing here.',
  '받은 값이 없습니다': 'No values received',

  // ── XLog 툴바 / 필터 ──────────────────────────────────
  'Y축': 'Y axis',
  '범위': 'Range',
  '1분': '1 min',
  '5분': '5 min',
  '10분': '10 min',
  '30분': '30 min',
  '응답': 'Elapsed',
  '응답(ms)': 'Elapsed(ms)',
  '서비스': 'Service',
  'URL 일부': 'part of URL',
  '0 이나 빈 칸이면 조건 없음': '0 or blank means no condition',
  '휠=확대 · Shift+휠=이동': 'wheel = zoom · Shift+wheel = pan',
  '선택 해제': 'Clear selection',
  '점의 높이를 무엇으로 볼지. 응답시간·CPU·SQL 시간·SQL 건수 등':
    'What the dot height means — elapsed time, CPU, SQL time, SQL count, and so on',
  '가로축이 담는 시간. 좁힐수록 점이 덜 겹친다':
    'How much time the x axis covers. Narrower means fewer dots on top of each other',
  '실패한 트랜잭션만 남긴다': 'Keep only failed transactions',
  '화면 전환': 'Switch view',

  // ── 트랜잭션 목록 / 검색 ──────────────────────────────
  '트랜잭션': 'Transactions',
  '프로파일 검색': 'Search profiles',
  '선택한 구간의 트랜잭션 프로파일 안에서 찾습니다':
    'Searches inside the profiles of the selected transactions',
  '· 검색은 이 페이지 안에서만': '· search covers this page only',
  '이전 적중': 'Previous hit',
  '다음 적중': 'Next hit',

  // ── 상세 패널 ─────────────────────────────────────────
  '상세 닫기': 'Close detail',
  '호출 흐름': 'Call flow',
  '흐름이 없습니다': 'No flow',
  '프로파일': 'Profile',
  '프로파일이 없습니다': 'No profile',
  '프로파일을 불러오는 중': 'Loading profile',
  '프로파일 조회 중': 'Loading profiles',
  '연관 트랜잭션 조회 중': 'Loading related transactions',
  '스텝이 없습니다': 'No steps',
  '요약': 'Summary',
  '요약할 스텝이 없습니다': 'Nothing to summarize',
  '속성': 'Properties',
  'API 호출': 'API call',
  '바인딩': 'Bind',
  '상대 주소': 'Address',
  '예외 / 서비스': 'Exception / Service',
  '이 에러가 난 트랜잭션을 연다': 'Open the transaction that hit this error',

  // ── 카운터 / 패널 ─────────────────────────────────────
  '액티브 서비스': 'Active services',
  '실행 중인 트랜잭션': 'Running transactions',
  '지금 실행 중인 트랜잭션이 없습니다.': 'No transactions are running right now.',
  '여는 사이에 완료되면 상세가 남지 않습니다.':
    'If it finishes while you are opening it, no detail remains.',
  '서비스 그룹': 'Service groups',
  '그룹': 'Group',
  '토폴로지': 'Topology',
  '애플리케이션': 'Applications',
  '인스턴스': 'Instances',
  '커넥션 풀': 'Connection pools',
  '오브젝트별': 'By object',
  '오늘': 'Today',
  '오늘 집계가 없습니다.': 'No totals for today yet.',
  '방문자': 'Visitors',
  '서비스 호출': 'Service calls',
  '호스트 · 5분 집계': 'Host · 5-minute rollup',
  '알림': 'Alerts',
  '알림 없음': 'No alerts',

  // ── 오브젝트 / 에이전트 ───────────────────────────────
  '에이전트': 'Agent',
  '에이전트 없음': 'No agents',
  '연결되지 않음': 'Not connected',
  '연결 후 사용 가능합니다.': 'Available after connecting.',
  '필터 해제 — 전부 표시': 'Clear filter — show all',
  '스레드': 'Threads',
  '스레드가 없습니다.': 'No threads.',
  '클래스': 'Classes',
  '클래스가 없습니다.': 'No classes.',
  '열린 소켓이 없습니다.': 'No open sockets.',
  '스택이 오지 않았습니다.': 'No stacks arrived.',
  '스택 샘플링': 'Stack sampling',
  '켜 두면 5분 동안 스택을 주기적으로 모읍니다.':
    'While on, stacks are collected periodically for 5 minutes.',
  '켜기 (5분)': 'Start (5 min)',
  '끄기': 'Stop',
  '덤프 만들기': 'Create dump',
  '대상 JVM 의 스레드 덤프를 지금 떠서 에이전트에 파일로 남깁니다':
    'Takes a thread dump of the target JVM and writes it as a file on the agent',
  '저장된 덤프가 없습니다. 위의 &ldquo;지금 덤프 뜨기&rdquo;를 누르세요.':
    'No saved dumps. Use &ldquo;Take dump now&rdquo; above.',
  '힙 덤프': 'Heap dump',
  '텍스트 캐시 비우기': 'Clear text cache',
  '되돌릴 수 없는 작업': 'Cannot be undone',
  '한 번 더 눌러야 실행됩니다. 운영 중인 JVM 이면 영향이 바로 나타납니다.':
    'Press again to run. On a live JVM the effect is immediate.',
  '설정 파일을 통째로 바꿉니다': 'Replaces the whole configuration file',
  '설정 파일이 없습니다. 에이전트가 기본값으로 동작 중입니다.':
    'No configuration file. The agent is running on defaults.',
  '설정을 불러오지 못했습니다.': 'Could not load the configuration.',
  '기본값 그대로인 항목은 볼 이유가 없다': 'Entries left at their default are hidden',
  '정말 덮어쓸까요?': 'Overwrite it?',
  '통째로 바뀌고': 'is replaced as a whole and',

  // ── 설정 창 ───────────────────────────────────────────
  '데이터 디렉토리': 'Data directory',
  '비워두면 실행파일 경로 사용': 'Leave empty to use the executable folder',
  '실행파일 경로/': '(executable folder)/',
  '현재 저장 경로': 'Current paths',
  '설정 파일': 'Config file',
  '로그 파일': 'Log file',
  '마지막 접속 정보': 'Last connection',
  '호스트': 'Host',
  '포트': 'Port',
  '사용자': 'User',
  '저장 완료': 'Saved',
  '글자 크기': 'Text size',
  'SQL 바인딩 파라미터': 'SQL bind parameters',
  '비밀번호가 config.json 에 평문으로 저장됩니다':
    'The password is stored in config.json as plain text',
  '실제 Collector 없이 합성 데이터로 차트 테스트':
    'Test the chart with synthetic data, without a collector',

  '언어': 'Language',
  '이름 · 타입 찾기': 'find by name or type',
  '검색어 지우기': 'clear search',
  '건 찾음': ' found',
  '건 중': ' of',
  'DEMO (합성 데이터)': 'DEMO (synthetic data)',
  'Scouter 용어(TPS·XLog·Elapsed)는 원래 영어라 두 언어에서 같습니다. 바뀌는 것은 설명과 레이블입니다.':
    'Scouter terms (TPS, XLog, Elapsed) are English in both languages. What changes is the labels and explanations we added.',


  // ── 2차: 목록·버튼·안내 ───────────────────────────────
  '완료': 'Done',
  ' 완료': ' done',
  '연결': 'Connect',
  '연결 해제': 'Disconnect',
  '저장': 'Save',
  '덮어쓰기': 'Overwrite',
  '수정 없음': 'No changes',
  '바뀐 내용이 없습니다': 'Nothing changed',
  '원문': 'Raw',
  '상세': 'Detail',
  '개별': 'Each',
  '과거': 'Past',
  '이 구간을 조회합니다': 'Load this range',
  '조건에 맞는 항목이 없습니다.': 'Nothing matches the filter.',
  '기본값과 다른 설정이 없습니다.': 'No settings differ from the defaults.',
  '포함 조건 — 눌러서 제외로': 'Include — click to exclude',
  'ERROR (일반)': 'ERROR (normal)',
  'DEBUG (개발)': 'DEBUG (development)',

  // 오브젝트 메뉴
  '스레드 덤프': 'Thread dump',
  '스레드 목록': 'Thread list',
  '로드된 클래스': 'Loaded classes',
  '모인 스택': 'Collected stacks',
  '소켓': 'Sockets',
  '환경변수': 'Environment',
  '힙 히스토그램': 'Heap histogram',
  '에이전트 작업…': 'Agent actions…',
  '지금 덤프 뜨기': 'Take dump now',
  '지금 스택 전체를 파일로': 'Write every stack to a file now',
  '실행 중인 트랜잭션을 파일로': 'Write the running transactions to a file',
  '스레드 상태 표를 파일로': 'Write the thread state table to a file',
  '클래스별 점유를 파일로': 'Write per-class usage to a file',
  'JVM 에이전트에서만 실행됩니다': 'Java agents only',
  'JVM 에이전트에서만 조회됩니다': 'Java agents only',
  '목록에서 이 오브젝트를 찾지 못했습니다. 방금 내려갔을 수 있습니다.':
    'This object is not in the list — it may have just gone down.',

  // 토폴로지
  '외부': 'External',
  '외부 유입': 'Inbound',
  '의존 자원': 'Dependencies',
  '호출 중인 외부 API': 'Outgoing API calls',
  '앱 사이의 호출만': 'Calls between apps only',
  'SQL·외부 API 까지 (프로파일을 추가로 조회한다)':
    'Down to SQL and outgoing APIs (fetches profiles as well)',

  // 설정 — SQL 바인딩
  '문장에 채워서 보기': 'Fill into the statement',
  '값을 따로 보기': 'Keep values separate',
  '예) where id=126': 'e.g. where id=126',
  '예) where id=? · 바인딩 126': 'e.g. where id=? · bind 126',

  // 안내
  '호스트 에이전트가 없습니다. scouter.host 를 콜렉터에 붙이면 CPU·메모리·네트워크가 표시됩니다.':
    'No host agent. Attach scouter.host to the collector to see CPU, memory and network.',
  '커넥션 풀이 수집되지 않았습니다. 앱의 spring.datasource.hikari.register-mbeans 와 에이전트의 jmx_counter_enabled 를 모두 켜야 합니다.':
    'No connection pools collected. Turn on both spring.datasource.hikari.register-mbeans in the app and jmx_counter_enabled in the agent.',


  // ── 템플릿 안 조각 ────────────────────────────────────
  ' 훑는 중…': ' scanning…',
  '개 오브젝트': ' objects',
  '개 풀': ' pools',
  '개 에이전트': ' agents',
  '개만 표시': ' shown',
  '상위': 'top',
  '상한': 'max',
  '자': ' chars',
  '수정됨': 'edited',
  '5분 집계': '5-minute rollup',
  '합계 없음': 'no total',
  '평균은 합계÷횟수': 'average = total ÷ count',
  '펼치기': 'Expand',
  '접기': 'Collapse',
  '조건 지우기': 'clear condition',
  '에이전트 tag': 'agent tag',
  '이 스레드로 이어진 작업을 엽니다': 'Opens the work that continued on this thread',
  ' 는 에이전트 2.21.3 에 수집 코드가 없어 받을 수 없습니다.':
    ' cannot be received — agent 2.21.3 has no collection code for it.',


  // ── 3차: 값과 섞인 조각 · 나머지 화면 ─────────────────
  // 숫자가 가운데 박힌 문구는 조각으로 이어 붙인다. 조각 하나가 곧 키다.
  '1시간': '1 hour',
  '6시간': '6 hours',
  '24시간': '24 hours',
  '1초 미만': 'under 1s',
  '1~3초': '1–3s',
  '3초 이상': 'over 3s',
  '실시간': 'Live',
  '조회': 'Load',
  '중단': 'Stop',
  '검색 해제': 'Clear search',
  '적중': 'hits',
  '못 읽음': 'unread',
  '선택': 'Selected',
  '선택한': 'the selected',
  '건 대상': ' transactions',
  '먼저 차트에서 구간을 드래그하세요': 'Drag a range on the chart first',
  'SQL·예외·URL 일부': 'part of SQL, exception or URL',
  '차트에서 영역을 드래그하면 그 구간의 트랜잭션이 여기에 나옵니다.':
    'Drag a range on the chart and its transactions appear here.',
  '건의 프로파일에서 찾지 못했습니다.': ' selected profiles had no match.',
  '너무 많아 일부만 표시합니다 — 구간을 좁혀 주세요':
    'Too many to draw — narrow the range',
  '불러오는 중…': 'Loading…',
  '느린': 'slowest',
  '느린 순': 'slowest first',
  '건만 표시 · 전체': ' shown · total',
  '이미 끝난 트랜잭션입니다.': 'This transaction has already finished.',

  // 필터 방향
  '포함': 'Include',
  '제외': 'Exclude',
  '이상': '≥',
  '미만': '<',
  '에러만': 'Errors only',
  '제외 조건 — 눌러서 포함으로': 'Exclude — click to include',

  // 요약 · 정렬
  '시간을 어디서 썼나': 'where the time went',
  '무엇이 많이 불렸나': 'what was called most',
  '한 번이 비싼 것': 'expensive per call',
  '어디서 실패하나': 'where it fails',
  '무엇이 반복되나': 'what repeats',
  '호출자 IP': 'Caller IP',
  '구간 누적': 'range total',
  '최근': 'last',
  '누적 ·': 'total ·',
  '행 · 호출 합계': ' rows · calls',
  '종 · 발생 합계': ' kinds · occurrences',
  '이 구간에 쌓인 요약이 없습니다.': 'No summary was collected for this range.',

  // 액티브 서비스
  '액티브 서비스 목록': 'Active service list',
  '지금 이 순간': 'right now',
  '지금 돌고 있는 트랜잭션이 없습니다': 'No transactions are running',
  '의 목록이 완전하지 않습니다': ' has an incomplete list',
  '눈금': 'grid',
  '실행 중인 SQL': 'Running SQL',
  '스택 트레이스': 'Stack trace',
  '스택 트레이스 보기': 'Show stack trace',
  '바인드:': 'Bind:',

  // 에이전트 목록
  '활성': 'live',
  '개만 · 전체로': ' only · show all',
  '자바 에이전트가 없습니다.': 'No Java agents.',
  '실시간 팩에 없는 카운터': 'counters absent from the realtime pack',
  '는 에이전트': ' — agent',
  '이 값을 계산만 하고 어떤 팩에도 싣지 않아 받을 수 없습니다.':
    ' computes these but never puts them in any pack, so they cannot be received.',

  // 알림
  '알림 (': 'Alerts (',

  // 설정 편집기
  '저장하면': 'Saving replaces',
  '의 설정 파일이 이 내용으로': ' configuration file with this content and',
  '에이전트가 설정을 다시 읽습니다. 지우고 저장한 줄은':
    ' the agent reloads it. Lines you delete and save',
  '기본값으로 돌아갑니다.': ' return to their defaults.',
  '아니요': 'No',
  '편집': 'Edit',
  '편집 취소': 'Cancel edit',
  '저장…': 'Save…',
  '저장 중…': 'Saving…',
  '바뀐 것만': 'Changed only',
  '기본': 'default',
  '개 · 기본값과 다른 항목': ' entries · differing from defaults',
  '에이전트 설정': 'Agent configuration',
  '에이전트 작업': 'Agent actions',

  // 오브젝트 인스펙터
  '← 목록': '← Back',
  '목록': 'List',
  '새로고침': 'Refresh',
  '이전': 'Prev',
  '다음': 'Next',
  '페이지': ' pages',
  '뜨는 중…': 'Working…',
  '항목': 'entries',
  '개': '',
  '개 중': ' of',
  '개:': ':',
  '개만 채웠습니다': ' filled',
  '넓은 구간에서 찾기': 'Search a wide range',
  '차트 Y축이 그리는 값입니다': 'The value the chart Y axis plots',
  '묶기': 'Group by',
  '타입': 'Type',
  '오브젝트 종류로 묶습니다 (tomcat · datasource · linux)':
    'Group by object kind (tomcat, datasource, linux)',
  '이름의 부모 경로로 묶습니다 (/CJFW/PRD-FSCP)': "Group by the name's parent path (/CJFW/PRD-FSCP)",
  '(그룹 없음)': '(no group)',
  '서버가 걸러서 보내 줍니다. 상한을 확인하는 중입니다…':
    'The collector filters and sends back the matches. Checking the limit…',
  '찾기': 'Search',
  '구간과 조건을 정해 서버에서 찾습니다': 'Pick a range and conditions; the collector does the filtering',
  '서버가 걸러서 보내 줍니다. 최대': 'The collector filters and sends back at most ',
  '건까지만 오고, 그보다 많으면 잘립니다.': ' rows — anything beyond that is cut off.',
  '(서버 설정에 상한이 안 적혀 있어 기본값으로 봅니다)':
    '(the limit is not in the server config, so this is the default)',
  '그냥 치면 «포함»으로 찾습니다. * 를 직접 쓰면 그 자리만 아무 글자로 봅니다.':
    'Plain text matches anywhere in the value. Type * yourself to place your own wildcards.',
  '시작이 끝보다 앞서야 합니다': 'Start must come before end',
  '구간': 'Range',
  '오브젝트': 'Object',
  '로그인': 'Login',
  '설명': 'Desc',
  '앱 자유 필드 (text1~5)': 'App free fields (text1-5)',
  '앱 자유 필드 접기': 'Hide app free fields',
  '찾는 중…': 'Searching…',
  '건에서 잘렸을 수 있습니다': ' rows — results may be cut off',
  '서버 상한에 닿았습니다. 조건을 좁히거나 구간을 나눠 다시 찾으십시오.':
    'The server limit was reached. Narrow the conditions or split the range and search again.',
  '서버 상한에 닿은 것으로 보입니다. 상한이 설정에 안 적혀 있어 기본값으로 판단했습니다.':
    'The server limit looks reached. It is not in the server config, so the default was assumed.',
  '행': ' rows',
  '바꾼 행 수 모름': 'rows changed: unknown',
  '에이전트가 보고한 갱신 건수입니다. 같은 연결로 여러 번 갱신하면 앞 문장에 얹혀 실제보다 크게 나올 수 있습니다.':
    'Update count as reported by the agent. When one connection runs several updates in a row, counts spill onto the previous statement and can read higher than reality.',
  '단축키': 'Keyboard shortcuts',
  '입력칸에 글자를 치는 중에는 동작하지 않습니다. Esc 는 그 칸에서 빠져나옵니다.':
    'Shortcuts stay out of the way while you are typing in a field. Esc leaves the field.',
  '보고 있는 상세 닫기': 'Close the transaction you are viewing',
  '프로파일 검색으로 이동': 'Jump to profile search',
  'XLog 탭': 'XLog tab',
  'Counter 탭': 'Counter tab',
  'Alert 탭': 'Alert tab',
  '상세 탭 닫기': 'Close detail tab',
  '다음 상세 탭': 'Next detail tab',
  '이전 상세 탭': 'Previous detail tab',
  '설정 열기': 'Open settings',
  '실시간 ↔ 과거': 'Live ↔ past',
  '다시 조회 (과거 구간)': 'Query again (past range)',
  '모두 닫기': 'Close all',
  '여는 중…': 'Opening…',
  '열어 둔 상세를 모두 닫습니다': 'Close every open transaction',
  '이 탭 닫기': 'Close this tab',
  '에이전트가 SQL 문장을 받지 못했습니다': 'The agent did not capture the SQL statement',
  '자동 생성 키를 쓰는 INSERT 는 에이전트가 문장을 얻지 못합니다. 드라이버가 문장 없이 PreparedStatement 를 만들기 때문이고, 콜렉터까지 문장이 오지 않아 화면에서 복원할 수 없습니다.':
    'For an INSERT that returns generated keys, the driver builds the PreparedStatement without the statement text, so the agent never sees it. The text never reaches the collector and cannot be recovered here.',
  '에이전트는 setXxx 로 넘어온 값만 기록합니다. 프로시저의 OUT 파라미터처럼 넣은 값이 없는 자리는 ? 로 남습니다.':
    'The agent records only values passed through setXxx. Slots with no input value — a procedure OUT parameter, for instance — stay as ?.',
  '자리': 'slots',
  '쓰이지 않은 값': 'Unused values',
  '개 클래스 · 합계': ' classes · total',
  '개만 표시 (검색으로 좁히세요)': ' shown (narrow with search)',
  '모인 스택이 없습니다.': 'No stacks collected.',
  '«에이전트 작업 → 스택 샘플링»을 켜면 10초 간격으로 쌓입니다.':
    'Turn on «Agent actions → Stack sampling» and they pile up every 10 seconds.',
  '히스토그램이 비었습니다. 앱 컨테이너가 JRE 면': 'The histogram is empty. If the app container is a JRE,',
  '가 없어 빈 결과가': ' is missing and the result comes back empty',
  '옵니다.': '.',
  '가': '',
  '줄': ' lines',
  '스택': 'stack',

  // 에이전트 작업 결과
  '실행': 'Run',
  '실행 중…': 'Running…',
  '실행할까요?': ' — run it?',
  '샘플링 시작': 'start sampling',
  '샘플링 중지': 'stop sampling',
  '스택 샘플링을 켰습니다 (5분)': 'Stack sampling is on (5 min)',
  '스택 샘플링을 껐습니다': 'Stack sampling is off',
  '그 순간 응답이 멈춥니다': 'responses stop at that moment',
  'GC 를 요청했습니다. 콜렉터가 결과를 알려주지 않으므로 Heap 카운터로 확인하세요':
    'GC requested. The collector does not report the result — check the Heap counter.',
  '힙 크기만 한 파일이 디스크에 생깁니다': 'A file the size of the heap is written to disk',
  '힙 덤프를 요청했습니다': 'Heap dump requested',
  '해시가 이름으로 안 풀릴 때': 'when hashes do not resolve to names',
  '캐시를 비웠습니다. 다음 전송부터 이름이 다시 올라옵니다':
    'Cache cleared. Names come back with the next transmission.',
  '을 만들었습니다': ' created',
  '에이전트 디스크에 파일이 생깁니다. 만든 뒤 해당 화면에서 볼 수 있습니다.':
    'A file is written on the agent. Open the matching screen afterwards to read it.',

  // 서비스 그룹 · 토폴로지
  '개 그룹': ' groups',
  '초 동안 들어온 요청이 없습니다.': ' seconds saw no requests.',
  '호출': 'calls',
  '호출 관계': 'call graph',
  '호출 관계가 수집되지 않았습니다.': 'No call graph was collected.',
  '기본으로 꺼져 있습니다 — 켜면 30초 뒤부터 쌓입니다.':
    'is off by default — turn it on and data starts arriving after 30 seconds.',
  '앱': 'App',

  // 5분 집계
  '집계는 오지만 구간 내 값이 모두 0입니다.': 'Rollups arrive but every value in the range is 0.',

  // 흐름
  '건을 못 받아 그만큼 잎이 빠져 있습니다': ' profiles could not be fetched — that many leaves are missing',


  // ── 4차: 설정 창 · 접속 폼 ────────────────────────────
  '로그 파일과 설정 파일이 저장될 경로입니다.': 'Where the log and config files are stored.',
  '비워두면': 'Leave it empty and',
  '가 사용됩니다.': ' is used.',
  '(실행파일 경로)': '(executable folder)',
  '화면 전체에 적용됩니다. 표·차트 눈금·프로파일 본문이 같은 비율로 커집니다.':
    'Applies to the whole screen — tables, chart ticks and profile text grow by the same ratio.',
  '프로파일의 SQL 은 값 대신': 'Profile SQL arrives with',
  '로 옵니다. 값을 문장에 채워 넣으면 그대로 복사해 DB 에 붙일 수 있습니다.':
    ' instead of values. Filling them in lets you copy the statement straight into a database.',
  '※ 경로 변경은 앱 재시작 후 적용됩니다.': '※ A path change takes effect after restarting the app.',
  '보통': 'Normal',
  '자동 연결': 'Auto connect',
  '연결 중…': 'Connecting…',

  // ── 서버 갈아타기 ─────────────────────────────────────
  '서버 고르기': 'Choose server',
  '붙을 서버를 고릅니다': 'Choose which collector to connect to',
  '바꾸는 중…': 'Switching…',
  '비밀번호 물음': 'asks for password',
  '지우기': 'remove',
  '목록에서 지웁니다': 'Remove from the list',

  // ── 버퍼 상한 ─────────────────────────────────────────
  '버퍼 상한': 'Buffer limit',
  '건 — 오래된 점부터 지웁니다. 범위를 좁히거나 설정에서 상한을 올리면 다 보입니다':
    ' — dropping the oldest dots. Narrow the range, or raise the limit in Settings',
  'XLog 버퍼 상한': 'XLog buffer limit',
  '차트가 들고 있을 최대 건수입니다. 넘으면 오래된 점부터 버립니다 — 창(범위)은 30분인데 화면에는 그보다 짧은 구간만 남는다면 이 값이 먼저 걸린 것입니다. 올릴수록 메모리를 씁니다.':
    'How many transactions the chart keeps. Past this, the oldest dots are dropped — if the range says 30 minutes but the chart shows less, this limit hit first. Higher costs memory.',
  '선택한 값의 대략적인 메모리:': 'Rough memory for this choice:',
  '기본값보다 큽니다': 'above the default',

  // ── 시계 어긋남 ───────────────────────────────────────
  '데이터 시각이 이 PC 보다': 'Data timestamps are',
  '초 앞섭니다 — 최신 점이 창 밖에 있을 수 있습니다':
    's ahead of this PC — the newest dots may fall outside the window',
  '초 뒤처집니다 — 오른쪽이 비어 보일 수 있습니다':
    's behind this PC — the right edge may look empty',

  // ── 카운터 서버 고르기 ────────────────────────────────
  // '서버'·'전체' 는 위에 이미 있다. 같은 말을 두 번 적으면 사전이 갈린다.
  '전체 보기': 'Show all',
  '그릴 서버를 고릅니다': 'Choose which servers to plot',

  // ── 상세 안에서 찾기 ──────────────────────────────────
  '이 안에서 찾기': 'Find in this profile',
  '없음': 'none',
  '누르면 목록에서 이 스텝으로 갑니다': 'Click to jump to this step in the list',

  // ── 표 내보내기 ───────────────────────────────────────
  '내보내기': 'Export',
  '내보냈습니다': 'Exported',
  '화면에 보이는 50줄이 아니라 받아 온 전부를 CSV 로 남깁니다':
    'Writes every row fetched to CSV, not just the 50 shown',

  // ── 하루 누적 ─────────────────────────────────────────
  '그날 하루의 누적을 봅니다': 'Show cumulative counts for that day',
  '방문자는 오늘만': 'Visitors: today only',

  // ── 프로파일 저장본 ───────────────────────────────────
  '저장본': 'Saved',
  '저장한 프로파일': 'Saved profiles',
  '이 트랜잭션을 파일로 저장합니다': 'Save this transaction to a file',
  '파일로 남겨 둔 프로파일을 엽니다': 'Open a profile saved to a file',
  '저장했습니다': 'Saved',
  '폴더 열기': 'Open folder',
  '저장한 프로파일이 없습니다. 상세 패널의 «저장» 을 누르면 여기 쌓입니다.':
    'No saved profiles yet. Use «Save» in the detail panel and they show up here.',

  // ── 레이아웃 ──────────────────────────────────────────
  '서비스 목록 너비': 'Service list width',
  '상세 패널 너비': 'Detail panel width',
  '트랜잭션 목록 높이': 'Transaction list height',
};
