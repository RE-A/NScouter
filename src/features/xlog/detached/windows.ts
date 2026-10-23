// 떼어 낸 XLog 창 열기·찾기·닫기 (메인 창 쪽).
//
// 같은 이름의 창이 이미 있으면 새로 열지 않고 그 창을 앞으로 부른다.

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { availableMonitors, getCurrentWindow } from '@tauri-apps/api/window';
import { WINDOW_QUERY, type WindowBounds } from './protocol';

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
 * 떼어 낸 창을 연다.
 *
 * @param at     탭을 창 밖에 끌어 놓은 화면 좌표 — **그 자리에** 연다(그 모니터 안으로 민다)
 * @param bounds 켤 때 되살리는 창 자리 — 지난번 그 자리·크기
 */
export async function openXLogWindow(
  label: string,
  title: string,
  opts: { at?: ScreenPoint; bounds?: WindowBounds | null } = {},
): Promise<void> {
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  const place = opts.bounds
    ? {
        x: Math.round(opts.bounds.x),
        y: Math.round(opts.bounds.y),
        width: Math.round(opts.bounds.width),
        height: Math.round(opts.bounds.height),
      }
    : { ...SIZE, ...(opts.at ? placeWindow(opts.at, await workAreas()) : {}) };
  // 생성자가 실패를 이벤트로 알린다 — 조용히 삼키면 «눌렀는데 아무 일도 없다» 가 된다
  const win = new WebviewWindow(label, {
    url: `index.html?${WINDOW_QUERY}=${encodeURIComponent(label)}`,
    title: `NScouter — ${title}`,
    ...place,
    focus: true,
  });
  await new Promise<void>((resolve, reject) => {
    void win.once('tauri://created', () => resolve());
    void win.once<string>('tauri://error', e => reject(new Error(String(e.payload))));
  });
}

export async function focusXLogWindow(label: string): Promise<void> {
  const w = await WebviewWindow.getByLabel(label);
  await w?.setFocus();
}

/** 이 창의 자리·크기 (논리 좌표). 못 물어보면 null */
export async function currentWindowBounds(): Promise<WindowBounds | null> {
  try {
    const w = getCurrentWindow();
    const [pos, size, scale] = await Promise.all([w.outerPosition(), w.innerSize(), w.scaleFactor()]);
    return { x: pos.x / scale, y: pos.y / scale, width: size.width / scale, height: size.height / scale };
  } catch {
    return null;
  }
}
