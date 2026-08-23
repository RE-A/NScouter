# 부하 상태에서 XLog 신호 품질을 요약한다.
# NScouter 스캐터 차트가 검증하려는 항목(응답시간 분포 / 에러 / 분산 트랜잭션 / SQL)이
# 실제로 발생하고 있는지 한 번에 확인하는 용도.
import socket
import struct
import hashlib
import sys

import login_check as L
import xlog_check as X


def connect(host, port):
    s = socket.create_connection((host, port), timeout=15)
    s.sendall(struct.pack(">I", L.MAGIC))
    return s, L.R(s)


def main(host="127.0.0.1", port=6100, user="admin", pw="admin"):
    pw_hash = hashlib.sha256((L.SALT + pw).encode()).hexdigest()

    # 로그인
    s, r = connect(host, port)
    param = {
        "id": (L.V_TEXT, user),
        "pass": (L.V_TEXT, pw_hash),
        "version": (L.V_TEXT, "Nscouter-1.0"),
        "hostname": (L.V_TEXT, "signal-check"),
        "isSocks": (L.V_BOOL, False),
        "socksIp": (L.V_TEXT, ""),
        "socksPort": (L.V_DEC, 0),
    }
    s.sendall(L.w_text("LOGIN") + struct.pack(">q", 0) + L.w_mappack(param))
    res = None
    while True:
        flag = r.u8()
        if flag == L.F_NO_NEXT:
            break
        if flag == L.F_HAS_NEXT and r.u8() == L.PACK_MAP:
            res = r.mappack()
    s.close()
    session = res.get("session", 0) if res else 0
    if not session:
        print("로그인 실패")
        return 1

    # 오브젝트 목록
    s, r = connect(host, port)
    s.sendall(L.w_text("OBJECT_LIST_REAL_TIME") + struct.pack(">q", session) + L.w_mappack({}))
    hashes, names = [], {}
    while True:
        flag = r.u8()
        if flag == L.F_NO_NEXT or flag != L.F_HAS_NEXT:
            break
        if r.u8() == L.PACK_OBJECT:
            r.text()
            h = r.decimal()
            n = r.text()
            r.text(); r.text(); r.u8(); r.decimal(); r.value()
            hashes.append(h)
            names[h] = n
    s.close()

    if not hashes:
        print("에이전트 없음")
        return 1

    # 실시간 XLog
    s, r = connect(host, port)
    s.sendall(L.w_text("TRANX_REAL_TIME_GROUP_LATEST")
              + struct.pack(">q", session) + X.w_param(hashes, 0, 0))
    xs = []
    while True:
        flag = r.u8()
        if flag == L.F_NO_NEXT or flag != L.F_HAS_NEXT:
            break
        pt = r.u8()
        if pt == X.PACK_XLOG:
            xs.append(X.read_xlog(r))
        elif pt == L.PACK_MAP:
            r.mappack()
    s.close()

    if not xs:
        print("XLog 0건 — 트래픽이 없거나 수집 경로에 문제가 있다")
        return 2

    el = sorted(x["elapsed"] for x in xs)
    sq = [x["sqlCount"] for x in xs]

    def pct(q):
        return el[min(len(el) - 1, int(len(el) * q))]

    buckets = {"<50ms": 0, "50-200ms": 0, "200ms-1s": 0, "1-3s": 0, ">3s": 0}
    for v in el:
        if v < 50:
            buckets["<50ms"] += 1
        elif v < 200:
            buckets["50-200ms"] += 1
        elif v < 1000:
            buckets["200ms-1s"] += 1
        elif v < 3000:
            buckets["1-3s"] += 1
        else:
            buckets[">3s"] += 1

    print(f"총 XLog       : {len(xs)}건")
    print("에이전트별    :",
          {names[h].split('/')[-1]: sum(1 for x in xs if x["objHash"] == h) for h in hashes})
    print(f"error != 0    : {sum(1 for x in xs if x['error'] != 0)}건  (빨간 점)")
    print(f"caller != 0   : {sum(1 for x in xs if x['caller'] != 0)}건  (분산 트랜잭션 하위)")
    print(f"sqlCount > 0  : {sum(1 for v in sq if v > 0)}건 / 최대 {max(sq)}")
    print(f"sqlTime 최대  : {max(x['sqlTime'] for x in xs)}ms")
    print(f"elapsed       : min {el[0]} / p50 {pct(0.5)} / p90 {pct(0.9)} "
          f"/ p99 {pct(0.99)} / max {el[-1]} ms")
    print(f"elapsed 분포  : {buckets}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
