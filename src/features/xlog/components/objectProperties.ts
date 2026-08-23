// 오브젝트 속성 표 만들기 (ASIS ObjectPropertiesDialog)
//
// ASIS 는 고정 8줄 + tags 를 통째로 이어 붙인다. 그 순서를 그대로 따른다 —
// 두 화면을 나란히 놓고 비교하는 사람이 있다.
//
// **tags 를 구조체로 뽑지 않는다.** 실측에서 tomcat 은 `ADC/counter/detected`,
// linux 는 `hostName/podName/kubeSeq/useKubeSeq` 로 키가 달랐다.
// 아는 키만 뽑으면 새 에이전트의 정보가 조용히 사라진다.

import type { AgentObject } from '../types/xlog';
import {
  isDatasourceObjectType,
  isHostObjectType,
  isJavaeeObjectType,
} from '../types/counter';

export interface PropertyRow {
  key: string;
  value: string;
  /** 색 견본을 그릴 줄. 값 문자열은 #RRGGBB */
  isColor?: boolean;
  /** tags 에서 온 줄. 고정 항목과 구분해 표시한다 */
  fromTags?: boolean;
}

/** counters.xml 의 Family. 카운터가 Family 단위로 정의되므로 이게 곧 "무엇을 물을 수 있나"다 */
export function familyOf(objType: string): string {
  if (isJavaeeObjectType(objType)) return 'javaee';
  if (isHostObjectType(objType)) return 'host';
  if (isDatasourceObjectType(objType)) return 'datasource';
  return '알 수 없음';
}

/**
 * `yyyy-MM-dd HH:mm:ss.SSS`.
 *
 * **0 은 시각이 아니다.** epoch 0 을 그대로 넣으면 "1970-01-01" 이 찍혀
 * 아주 오래전에 살아 있었다는 거짓말이 된다.
 */
export function formatWakeup(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  );
}

export function buildPropertyRows(obj: AgentObject, color: string): PropertyRow[] {
  const rows: PropertyRow[] = [
    { key: 'objectName', value: obj.obj_name },
    { key: 'objectType', value: obj.obj_type },
    { key: 'family', value: familyOf(obj.obj_type) },
    { key: 'address', value: obj.address },
    { key: 'version', value: obj.version },
    { key: 'alive', value: String(obj.alive) },
    { key: 'wakeUp', value: formatWakeup(obj.wakeup) },
    { key: 'color', value: color, isColor: true },
  ];
  for (const [k, v] of obj.tags) {
    rows.push({ key: k, value: v, fromTags: true });
  }
  return rows;
}
