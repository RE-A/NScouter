// 알림 수신 — **앱 전체에서 하나만** 둔다.
//
// 배지(AlertPanel)와 목록(Alert 탭)이 각자 버퍼를 갖고 있었다. 배지는 항상 떠 있고
// 목록은 그 탭에 있을 때만 마운트되므로, **다른 탭을 보는 동안 온 알림은 목록에 없다.**
// 배지에 2가 떠서 눌러 들어가면 빈 화면이 나온다 — 알림을 읽으러 가는 화면인데.
//
// 실제로 그 증상을 화면에서 확인하고 이 훅으로 합쳤다.

import { useCallback, useEffect, useState } from 'react';
import { onAlertData } from '../api/scouterApi';
import { subscribe } from '../api/subscribe';
import type { AlertPack } from '../types/alert';

/** 넘치면 오래된 것부터 버린다. 알림은 최신이 중요하다 */
const MAX_ALERTS = 200;

export interface AlertStream {
  /** 최신순 */
  alerts: AlertPack[];
  /** 아직 안 본 개수. 배지에 쓴다 */
  unread: number;
  /** 감시를 시작한 시각. 빈 화면이 고장이 아님을 보이는 근거 */
  since: number | null;
  clear: () => void;
  markRead: () => void;
}

export function useAlertStream(connected: boolean): AlertStream {
  const [alerts, setAlerts] = useState<AlertPack[]>([]);
  const [unread, setUnread] = useState(0);
  const [since, setSince] = useState<number | null>(null);

  useEffect(() => {
    if (!connected) {
      setSince(null);
      return;
    }
    setSince(Date.now());
    return subscribe(
      onAlertData(pack => {
        setAlerts(prev => {
          const next = [pack, ...prev];
          return next.length > MAX_ALERTS ? next.slice(0, MAX_ALERTS) : next;
        });
        setUnread(n => n + 1);
      }),
    );
  }, [connected]);

  const clear = useCallback(() => {
    setAlerts([]);
    setUnread(0);
  }, []);

  const markRead = useCallback(() => setUnread(0), []);

  return { alerts, unread, since, clear, markRead };
}
