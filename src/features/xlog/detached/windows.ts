// 떼어 낸 XLog 창 열기·찾기·닫기 (메인 창 쪽).
//
// 창 이름은 탭 키에서 만든다(`windowLabelOf`). 같은 탭을 두 번 떼면 새로 열지 않고 그 창을 앞으로 부른다.

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { availableMonitors } from '@tauri-apps/api/window';
import { DETACHED_QUERY, windowLabelOf } from './wire';

export interface ScreenPoint {
  x: number;
  y: number;
}

/** 새 창의 크기. 차트 하나가 읽히는 정도 — 크기는 사람이 바꾼다 */
const SIZE = { width: 1000, height: 640 };

/** 화면의 작업 영역 (논리 좌표) */
export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 새 창을 놓을 자리.
 *
 * 끌어 놓은 자리에 창 머리가 오게 하되, **그 자리가 든 화면 안에 다 들어오게** 민다 —
 * 화면 오른쪽 끝에 놓으면 창이 거의 다 화면 밖에 뜨던 것. 놓은 자리가 어느 화면에도 없으면
 * 가장 가까운 화면에 둔다.
 */
export function placeWindow(at: ScreenPoint, areas: readonly Area[], size = SIZE): ScreenPoint {
  const want = { x: at.x - 120, y: at.y - 16 };
  if (areas.length === 0) return { x: Math.max(0, Math.round(want.x)), y: Math.max(0, Math.round(want.y)) };
  const dist = (a: Area) => {
    const dx = Math.max(a.x - at.x, 0, at.x - (a.x + a.width));
    const dy = Math.max(a.y - at.y, 0, at.y - (a.y + a.height));
    return dx * dx + dy * dy;
  };
  const area = [...areas].sort((p, q) => dist(p) - dist(q))[0];
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  return {
    x: Math.round(clamp(want.x, area.x, area.x + area.width - size.width)),
    y: Math.round(clamp(want.y, area.y, area.y + area.height - size.height)),
  };
}

/** 모니터들의 작업 영역 — 논리 좌표로. 못 물어보면 빈 배열(그때는 놓은 자리 그대로) */
async function workAreas(): Promise<Area[]> {
  try {
    return (await availableMonitors()).map(m => ({
      x: m.workArea.position.x / m.scaleFactor,
      y: m.workArea.position.y / m.scaleFactor,
      width: m.workArea.size.width / m.scaleFactor,
      height: m.workArea.size.height / m.scaleFactor,
    }));
  } catch {
    return [];
  }
}

/**
 * 탭을 새 창으로 연다.
 *
 * @param at 탭을 끌어 놓은 화면 좌표. 주면 **그 자리에** 연다 — 다른 모니터로 끌어 놓았으면 그 모니터에 뜬다
 */
export async function openDetachedWindow(key: string, title: string, at?: ScreenPoint): Promise<void> {
  const label = windowLabelOf(key);
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  const pos = at ? placeWindow(at, await workAreas()) : null;
  // 생성자가 실패를 이벤트로 알린다 — 조용히 삼키면 «눌렀는데 아무 일도 없다» 가 된다
  const win = new WebviewWindow(label, {
    url: `index.html?${DETACHED_QUERY}=${encodeURIComponent(key)}`,
    title: `NScouter — ${title}`,
    ...SIZE,
    ...(pos ?? {}),
    focus: true,
  });
  await new Promise<void>((resolve, reject) => {
    void win.once('tauri://created', () => resolve());
    void win.once<string>('tauri://error', e => reject(new Error(String(e.payload))));
  });
}

export async function focusDetachedWindow(key: string): Promise<void> {
  const w = await WebviewWindow.getByLabel(windowLabelOf(key));
  await w?.setFocus();
}

/** 창을 닫는다. **닫힘 인사(bye)를 보내지 않는다** — 부르는 쪽이 이미 탭을 붙였다 */
export async function closeDetachedWindow(key: string): Promise<void> {
  const w = await WebviewWindow.getByLabel(windowLabelOf(key));
  await w?.destroy();
}
