// 화면 표시 설정 (config.json 과 같이 사는 값)
//
// SettingsDialog 는 열릴 때만 설정을 읽는다. 표시 설정은 **화면 여기저기가 같이 봐야** 해서
// 한 곳에 모아 둔다 — 모듈 수준 저장소 하나에 담고 바뀌면 구독자에게 알린다.
//
// 컨텍스트를 쓰지 않는 이유: 이 값은 앱 전체에 하나뿐이고 거의 안 바뀐다.
// 트리 위에 Provider 를 하나 더 얹는 것보다 이쪽이 읽기 쉽다.

import { useEffect, useState } from 'react';
import { getConfig, saveConfig, type AppConfig } from '../api/scouterApi';

export interface ViewOptions {
  /** SQL 바인딩 파라미터를 문장에 채워 보여줄지 */
  sqlBindInline: boolean;
}

/**
 * 기본값.
 *
 * **채우기가 기본이다.** `where id=?` 만 봐서는 무슨 값으로 느렸는지 알 수 없다.
 */
const DEFAULTS: ViewOptions = { sqlBindInline: true };

let current: ViewOptions = DEFAULTS;
let loaded = false;
const listeners = new Set<(v: ViewOptions) => void>();

function emit(): void {
  for (const fn of listeners) fn(current);
}

function fromConfig(cfg: AppConfig): ViewOptions {
  return { sqlBindInline: cfg.sql_bind_inline ?? DEFAULTS.sqlBindInline };
}

/** 설정 창이 저장한 뒤 부른다 — 다시 읽지 않고 바로 화면에 반영한다 */
export function applyConfigToViewOptions(cfg: AppConfig): void {
  current = fromConfig(cfg);
  loaded = true;
  emit();
}

/**
 * 값을 바꾸고 **config.json 까지 저장한다.**
 *
 * 화면에는 먼저 반영한다 — 저장을 기다리는 동안 스위치가 안 움직이면 고장으로 읽힌다.
 * 저장이 실패해도 이번 세션에서는 바뀐 대로 쓴다(다음 실행에 되돌아갈 뿐이다).
 */
export async function setViewOption<K extends keyof ViewOptions>(
  key: K,
  value: ViewOptions[K],
): Promise<void> {
  current = { ...current, [key]: value };
  emit();
  try {
    const cfg = await getConfig();
    await saveConfig({ ...cfg, sql_bind_inline: current.sqlBindInline });
  } catch {
    // 저장 실패는 화면을 되돌릴 이유가 못 된다. 다음 실행에 기본값으로 돌아갈 뿐이다.
  }
}

export function useViewOptions(): ViewOptions {
  const [value, setValue] = useState<ViewOptions>(current);

  useEffect(() => {
    listeners.add(setValue);
    // 처음 한 번만 읽는다. 화면마다 읽으면 같은 값을 여러 번 물어보게 된다.
    if (!loaded) {
      loaded = true;
      getConfig()
        .then(cfg => {
          current = fromConfig(cfg);
          emit();
        })
        .catch(() => {});
    }
    return () => {
      listeners.delete(setValue);
    };
  }, []);

  return value;
}
