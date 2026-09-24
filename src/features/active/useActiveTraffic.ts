// 최근 끝난 트랜잭션 — **이미 도는 스트림에서 줍는다.**
//
// 새로 요청하지 않는다. App 이 고른 서버로 XLog 실시간 스트림을 열어 두고 있고
// (`startXLogStream`), 그 이벤트는 어느 탭을 보고 있든 흐른다. 여기서는 같은 이벤트를
// 한 번 더 듣기만 한다 — 이 화면을 연다고 콜렉터·에이전트에 부담이 늘지 않는다.
//
// XLog 탭의 저장소와 **따로 담는다.** 저기는 창이 10~30분이고 상한이 10만 건이라
// Active 탭이 쓰려는 «최근 1분» 과 크기가 두 자릿수 다르다. 같은 저장소를 나눠 쓰면
// 한쪽의 창 설정이 다른 쪽을 흔든다.

import { useEffect, useRef, useState } from 'react';
import { onXLogData } from '../xlog/api/scouterApi';
import { subscribe } from '../xlog/api/subscribe';
import { xlogColumnsToSXLogs, type SXLog } from '../xlog/types/xlog';

/** 이 창에 담을 최대 건수. 1분에 이보다 많이 들어오면 오래된 것부터 버린다 */
const CAP = 20_000;

export interface TrafficFeed {
  /** 창 안에서 끝난 트랜잭션. **새 배열로 준다** — 그래야 화면이 다시 그린다 */
  done: readonly SXLog[];
  /** 한 번이라도 받은 적이 있는가. «아직 아무것도 안 왔다» 와 «없다» 는 다르다 */
  received: boolean;
}

/**
 * @param enabled 이 탭을 보고 있고 접속돼 있는가
 * @param windowMs 담아 둘 시간 창
 * @param connectionEpoch 접속이 바뀌면 이전 서버의 점을 버린다
 */
export function useActiveTraffic(
  enabled: boolean,
  windowMs: number,
  connectionEpoch = 0,
): TrafficFeed {
  const bufRef = useRef<SXLog[]>([]);
  const [feed, setFeed] = useState<TrafficFeed>({ done: [], received: false });

  useEffect(() => {
    bufRef.current = [];
    setFeed({ done: [], received: false });
    if (!enabled) return;

    let got = false;
    const off = subscribe(
      onXLogData(cols => {
        // 열로 받아 여기서 행으로 엮는다 (F-56) — 건당 이벤트면 1만 건에 콜백이 1만 번이다.
        for (const x of xlogColumnsToSXLogs(cols)) bufRef.current.push(x);
        got = true;
      }),
    );

    /**
     * 창 밖을 버리고 화면에 넘긴다.
     *
     * **받을 때마다 setState 하지 않는다.** 첫 묶음이 1만 건인 데다 초당 여러 번
     * 오는데, 그때마다 렌더가 돌면 이 탭 전체가 버벅인다. 점은 어차피 시간이 흘러야
     * 자리가 바뀌므로 화면 갱신 주기와 같은 리듬으로 밀어 준다.
     */
    const tick = () => {
      const cutoff = Date.now() - windowMs;
      let buf = bufRef.current;
      if (buf.some(x => x.endTime < cutoff)) buf = buf.filter(x => x.endTime >= cutoff);
      if (buf.length > CAP) buf = buf.slice(buf.length - CAP);
      bufRef.current = buf;
      setFeed({ done: buf.slice(), received: got });
    };

    const timer = setInterval(tick, 500);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [enabled, windowMs, connectionEpoch]);

  return feed;
}
