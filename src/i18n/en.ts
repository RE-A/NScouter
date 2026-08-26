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

  // ── 레이아웃 ──────────────────────────────────────────
  '서비스 목록 너비': 'Service list width',
  '상세 패널 너비': 'Detail panel width',
  '트랜잭션 목록 높이': 'Transaction list height',
};
