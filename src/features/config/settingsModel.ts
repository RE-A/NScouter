// 설정 화면의 모델 (순수 로직)
//
// 화면에 뜨는 항목은 **살아 있는 서버가 준 것**이다(`LIST_CONFIGURE_*`). 카탈로그는 거기에
// 한국어 이름·설명·구역을 얹을 뿐 항목을 만들어 내지 않는다 — 판이 달라 없는 항목을
// 카탈로그만 보고 띄우면, 저장해도 먹지 않는 설정을 고치게 된다.
//
// 거꾸로 카탈로그에 없는 항목(공식 문서 이후에 생긴 것, 플러그인이 쓰는 것)도 버리지 않는다.
// «기타» 에 모으고 에이전트가 준 설명을 붙인다.

import { KO } from './catalog/ko';
import { OFFICIAL } from './catalog/official';
import { OTHER_SECTION, SECTIONS, type SectionDef } from './catalog/sections';
import type { ConfigScope, OfficialOption } from './catalog/types';
import type { ConfigEntry } from '../xlog/types/config';
import { isHostObjectType } from '../xlog/types/counter';

/** 화면의 항목 하나 */
export interface SettingItem {
  entry: ConfigEntry;
  /** 한국어 이름. 카탈로그에 없으면 키 그대로 */
  label: string;
  /** 한국어 설명. 없으면 빈 문자열 */
  koDesc: string;
  /** 공식 설명 원문(영어). 카탈로그 → 없으면 에이전트가 준 것 */
  officialDesc: string;
  sectionId: string;
  /** 공식 문서에 있는 항목인가 */
  documented: boolean;
  /**
   * `_` 로 시작하는 항목.
   *
   * 스카우터 소스에서 `_` 로 시작하는 필드는 대개 공식 설명이 비어 있고(`_trace`,
   * `_hook_*_enabled` …) 일상적으로 고칠 것이 아니다. **숨기지 않고 접어 둔다** —
   * 기본값과 다르게 되어 있으면 늘 보인다(`isVisible`).
   */
  internal: boolean;
  /** 공식 설명이 «Deprecated» 로 시작한다 */
  deprecated: boolean;
  /**
   * 공식 설명에 «restart required» 가 적혀 있다.
   *
   * **문서가 말한 것만 적는다.** 포트·디렉터리처럼 재시작이 필요해 보이는 항목이 더 있지만,
   * 짐작으로 붙이면 틀렸을 때 화면이 틀린 말을 공식처럼 한다.
   */
  restartRequired: boolean;
  /**
   * `$measurement$` 같은 자리 표시가 든 **예시 항목**에 걸린 것이다.
   * 공식 문서가 «이 항목은 예시일 뿐» 이라고 적는 텔레그래프 항목들이다.
   */
  template: boolean;
}

export interface SettingSection {
  def: SectionDef;
  items: SettingItem[];
}

/**
 * 오브젝트 타입으로 설정 종류를 가른다.
 *
 * 호스트 에이전트는 설정 이름이 자바 에이전트와 겹치지만(`net_collector_ip` …) 항목 수와
 * 뜻이 다르다. 나머지(tomcat · java · datasource …)는 자바 에이전트 설정을 쓴다.
 */
export function scopeOfObjType(objType: string): ConfigScope {
  return isHostObjectType(objType) ? 'host' : 'java';
}

/** `$…$` 자리 표시를 «아무 글자» 로 바꾼 정규식. 예시 항목에 실제 키를 대 보려고 쓴다 */
function templateRegex(key: string): RegExp {
  const parts = key.split(/\$[^$]+\$/);
  const escaped = parts.map(p => p.replace(/[.*+?^{}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${escaped.join('.+')}$`);
}

interface ScopeIndex {
  byKey: Map<string, { opt: OfficialOption; order: number }>;
  templates: { re: RegExp; opt: OfficialOption; order: number }[];
  sectionOf: Map<string, string>;
}

const INDEX_CACHE = new Map<ConfigScope, ScopeIndex>();

function indexOf(scope: ConfigScope): ScopeIndex {
  const hit = INDEX_CACHE.get(scope);
  if (hit) return hit;

  const byKey = new Map<string, { opt: OfficialOption; order: number }>();
  const templates: ScopeIndex['templates'] = [];
  OFFICIAL[scope].forEach((opt, order) => {
    byKey.set(opt.key, { opt, order });
    if (opt.key.includes('$')) templates.push({ re: templateRegex(opt.key), opt, order });
  });

  const sectionOf = new Map<string, string>();
  for (const s of SECTIONS[scope]) for (const f of s.from) sectionOf.set(f, s.id);

  const idx = { byKey, templates, sectionOf };
  INDEX_CACHE.set(scope, idx);
  return idx;
}

/** 이 키에 해당하는 공식 항목. 정확히 같은 키가 먼저, 없으면 예시 항목에 대 본다 */
function findOfficial(
  scope: ConfigScope,
  key: string,
): { opt: OfficialOption; order: number; template: boolean } | null {
  const idx = indexOf(scope);
  const exact = idx.byKey.get(key);
  if (exact) return { ...exact, template: key.includes('$') };
  const t = idx.templates.find(x => x.re.test(key));
  return t ? { opt: t.opt, order: t.order, template: true } : null;
}

/** 살아 있는 항목에 카탈로그를 얹는다 */
export function toItem(scope: ConfigScope, entry: ConfigEntry): SettingItem & { order: number } {
  const found = findOfficial(scope, entry.key);
  const ko = found ? KO[scope][found.opt.key] : undefined;
  const officialDesc = found?.opt.desc || entry.desc;
  return {
    entry,
    label: ko?.[0] ?? entry.key,
    koDesc: ko?.[1] ?? '',
    officialDesc,
    sectionId: found ? (indexOf(scope).sectionOf.get(found.opt.section) ?? OTHER_SECTION.id) : OTHER_SECTION.id,
    documented: found !== null,
    internal: entry.key.startsWith('_'),
    deprecated: /^deprecated/i.test(officialDesc.trim()),
    restartRequired: /restart required/i.test(officialDesc),
    template: found?.template ?? false,
    // 공식 문서 순서를 지킨다 — 문서가 관련 항목을 붙여 적어 두었다(샘플링 구간 1·2·3 …)
    order: found ? found.order : Number.MAX_SAFE_INTEGER,
  };
}

/**
 * 구역별로 묶는다.
 *
 * 구역 순서는 카탈로그(`SECTIONS`) 순서, 구역 안은 공식 문서 순서, 문서에 없는 항목은
 * 이름순으로 «기타» 에 모은다. **빈 구역은 뺀다** — 누를 수는 있는데 아무것도 없는 구역은
 * 없느니만 못하다.
 */
export function buildSections(scope: ConfigScope, entries: readonly ConfigEntry[]): SettingSection[] {
  const items = entries.map(e => toItem(scope, e));
  const defs = [...SECTIONS[scope], OTHER_SECTION];
  return defs
    .map(def => ({
      def,
      items: items
        .filter(i => i.sectionId === def.id)
        .sort((a, b) => a.order - b.order || a.entry.key.localeCompare(b.entry.key)),
    }))
    .filter(s => s.items.length > 0);
}

/**
 * 검색 — 키·값·기본값·**한국어 이름·한국어 설명·공식 설명**.
 *
 * 낱말마다 따로 본다(`configEdits.matchesQuery` 와 같은 규칙). «콜렉터 포트» 로도,
 * `net_collector` 로도, 영어 원문 «socket timeout» 으로도 찾아야 한다.
 */
export function matchesSetting(item: SettingItem, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const e = item.entry;
  const hay = [e.key, e.value, e.default, item.label, item.koDesc, item.officialDesc]
    .join('\n')
    .toLowerCase();
  return words.every(w => hay.includes(w));
}

export interface VisibleOptions {
  query: string;
  changedOnly: boolean;
  showInternal: boolean;
  /** 고치고 있는 키 — 조건에 안 맞아도 남긴다 */
  editing: ReadonlySet<string>;
}

/**
 * 이 항목을 지금 보여 줄 것인가.
 *
 * **내부 항목이라도 기본값과 다르면 보인다.** 누군가 바꿔 둔 설정을 «내부» 라는 이유로
 * 가리면, 동작이 왜 기본과 다른지 이 화면에서 찾을 수 없다.
 * **고치고 있는 항목은 조건과 무관하게 남긴다** — 입력하는 도중에 목록에서 빠지면 안 된다.
 */
export function isVisible(item: SettingItem, o: VisibleOptions): boolean {
  if (o.editing.has(item.entry.key)) return true;
  if (o.changedOnly && !item.entry.changed) return false;
  if (item.internal && !o.showInternal && !item.entry.changed) return false;
  return matchesSetting(item, o.query);
}
