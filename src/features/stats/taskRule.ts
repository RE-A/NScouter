// Task 이름 규칙 — Rust `stats::engine::task_match` 와 같은 규칙
//
// 화면에서 «지금 이 규칙에 걸리는 서버» 를 미리 보이는 데 쓴다. 실제 작업은 Rust 가 구간마다 다시 고른다
// (지난 Task 도 그날 목록에서 찾는다).

/** `*` 는 아무 글자 여럿, `?` 는 한 글자. 둘 다 없으면 «포함». 대소문자 무시 */
export function taskMatch(pattern: string, name: string): boolean {
  const p = pattern.trim().toLowerCase();
  const n = name.toLowerCase();
  if (p === '') return false;
  if (!/[*?]/.test(p)) return n.includes(p);
  const re = new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 's');
  return re.test(n);
}

/** 이름이 규칙들 중 하나에 걸리는가 — 끝 마디(`/호스트/이름` 의 이름)와 전체 어느 쪽이든 */
export function picksByRule(patterns: readonly string[], name: string): boolean {
  const short = name.split('/').filter(s => s !== '').pop() ?? name;
  return patterns.some(p => taskMatch(p, short) || taskMatch(p, name));
}
