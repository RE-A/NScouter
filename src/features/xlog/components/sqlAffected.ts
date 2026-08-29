// SQL 이 몇 행을 바꿨는가 (`SqlStep3.updated`).
//
// 우리는 이 값을 받아만 놓고 화면 어디에도 쓰지 않았다 — 죽은 데이터였다.
// ASIS 는 `<Affected Rows : N>` 으로 붙여 준다(`ProfileText.toString(SqlStep …)`).
//
// **문장을 잃었을 때 남는 유일한 단서다.** 자동 생성 키를 쓰는 INSERT 는 에이전트가
// SQL 문장을 못 얻어 `unknown` 만 온다(F-53). 그때 «1행을 바꿨다» 가 있으면
// 적어도 읽기가 아니라 쓰기였다는 것은 알 수 있다.
//
// **다만 정확한 행 수가 아니다 (F-55).** 에이전트는 `getUpdateCount()` 가 불릴 때마다
// `ctx.lastSqlStep` 에 **더한다**:
//
//   if (step.updated == -2 && n > 0)      step.updated = n;
//   else if (step.updated >= 0 && n > 0)  step.updated += n;
//
// 다음 문장이 시작된 뒤에 도착한 호출은 **직전 스텝에 얹힌다.** 실측:
//
//   단독 UPDATE          n행 → n         (1→1 · 3→3 · 7→7, 정확)
//   반복문 안 UPDATE 5개  1행 → 2,2,2,2,1 (마지막만 맞다)
//
// 그래서 숫자를 그대로 두되 **«바꾼 행 수» 라고 단정하지 않는다** — 툴팁이 뜻을 적는다.
//
// 값의 뜻은 `SqlStep3` 의 주석 그대로다:
//   0 이상 : 바뀐 행 수
//   -1     : 결과 집합을 돌려준 실행 (읽기)
//   -2     : 갱신 건수인데 `getUpdateCount` 를 부르지 않아 모른다
//   -3     : SQL 예외

/** `SqlStep3.EXECUTE_RESULT_SET` — 읽기였다는 뜻이라 굳이 적지 않는다 */
export const EXECUTE_RESULT_SET = -1;
/** `SqlStep3.EXECUTE_UNKNOWN_COUNT` — 썼는데 몇 행인지는 모른다 */
export const EXECUTE_UNKNOWN_COUNT = -2;

export type Affected =
  /** 바뀐 행 수를 안다 */
  | { kind: 'rows'; count: number }
  /** 썼지만 몇 행인지 모른다 */
  | { kind: 'unknown' }
  /** 적을 것이 없다 (읽기이거나 예외) */
  | null;

/**
 * ASIS 와 같은 규칙으로 가른다.
 *
 * ```java
 * if (updated > EXECUTE_RESULT_SET)            " <Affected Rows : N>"
 * else if (updated == EXECUTE_UNKNOWN_COUNT)   " <Affected Rows : unknown>"
 * ```
 *
 * **0 은 «없음» 이 아니라 «한 행도 안 바뀜» 이다.** 조건에 맞는 행이 없어 아무것도
 * 안 바뀐 UPDATE 는 그 자체가 단서라 숨기지 않는다.
 */
export function affectedRows(updated: number): Affected {
  if (updated > EXECUTE_RESULT_SET) return { kind: 'rows', count: updated };
  if (updated === EXECUTE_UNKNOWN_COUNT) return { kind: 'unknown' };
  return null;
}
