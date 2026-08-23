# 실서버 응답 바이트를 그대로 캡처해 픽스처로 저장한다 (L3.5 계층).
#
#   python capture_fixtures.py
#
# 목적 두 가지.
#  1) PerfCounterPack / AlertPack 의 실제 와이어 포맷 확정 (N-5, N-6)
#  2) 요청 파라미터를 ASIS 방식 / NScouter 방식으로 각각 던져 비교 (N-8, N-9)
#
# 근거:
#  - COUNTER_REAL_TIME_ALL : CounterRealTimeAllView.java:287 (objType + counter → MapPack)
#  - ALERT_REAL_TIME       : AlertConsumer.java:40 (loop + index + objType → MapPack + AlertPack*)
import os
import socket
import struct
import sys

import login_check as L

PACK_MAP = 10
PACK_PERF_COUNTER = 60
PACK_ALERT = 70
PACK_OBJECT = 80

FIXDIR = os.path.join(os.path.dirname(__file__), "..", "..",
                      "src-tauri", "tests", "fixtures")


class Tap(L.R):
    """need() 로 소비한 바이트를 그대로 기록하는 리더."""

    def __init__(self, sock):
        super().__init__(sock)
        self.rec = None

    def need(self, n):
        out = super().need(n)
        if self.rec is not None:
            self.rec += out
        return out

    def start(self):
        self.rec = b""

    def stop(self):
        out, self.rec = self.rec, None
        return out


def login(host="127.0.0.1", port=6100, user="admin", pw="admin"):
    import hashlib
    s = socket.create_connection((host, port), timeout=10)
    s.sendall(struct.pack(">I", L.MAGIC))
    param = {
        "id": (L.V_TEXT, user),
        "pass": (L.V_TEXT, hashlib.sha256((L.SALT + pw).encode()).hexdigest()),
        "version": (L.V_TEXT, "Nscouter-1.0"),
        "hostname": (L.V_TEXT, "fixture-capture"),
        "isSocks": (L.V_BOOL, False),
        "socksIp": (L.V_TEXT, ""),
        "socksPort": (L.V_DEC, 0),
    }
    s.sendall(L.w_text("LOGIN") + struct.pack(">q", 0) + L.w_mappack(param))
    r = Tap(s)
    result = None
    while True:
        flag = r.u8()
        if flag == L.F_NO_NEXT:
            break
        if flag != L.F_HAS_NEXT:
            raise RuntimeError(f"예상치 못한 TcpFlag 0x{flag:02X}")
        if r.u8() == PACK_MAP:
            result = r.mappack()
    return s, r, result["session"]


def reopen(host="127.0.0.1", port=6100):
    """F-1: 콜렉터는 연결당 명령을 1개만 처리한다. 요청마다 소켓을 새로 연다.
    세션 토큰은 소켓과 무관하게 재사용 가능하다."""
    s = socket.create_connection((host, port), timeout=10)
    s.sendall(struct.pack(">I", L.MAGIC))
    return s, Tap(s)


def objects(sock, reader, session):
    """오브젝트 목록 → [(objType, objHash, objName)]"""
    sock.sendall(L.w_text("OBJECT_LIST_REAL_TIME")
                 + struct.pack(">q", session) + L.w_mappack({}))
    out = []
    while True:
        flag = reader.u8()
        if flag == L.F_NO_NEXT:
            break
        if reader.u8() != PACK_OBJECT:
            continue
        ot = reader.text()
        oh = reader.decimal()
        on = reader.text()
        reader.text()          # address
        reader.text()          # version
        reader.u8()            # alive
        reader.decimal()       # wakeup
        reader.value()         # tags
        out.append((ot, oh, on))
    return out


def w_list_decimal(values):
    out = bytes([70]) + L.w_decimal(len(values))
    for v in values:
        out += bytes([L.V_DEC]) + L.w_decimal(v)
    return out


def send(sock, cmd, session, body):
    sock.sendall(L.w_text(cmd) + struct.pack(">q", session) + body)


def drain(reader, label, capture_types=()):
    """응답을 끝까지 읽으며 팩 타입별 개수와 캡처 바이트를 돌려준다."""
    counts = {}
    caps = {}
    while True:
        flag = reader.u8()
        if flag == L.F_NO_NEXT:
            break
        if flag != L.F_HAS_NEXT:
            print(f"    !! 예상치 못한 TcpFlag 0x{flag:02X}")
            break
        pt = reader.u8()
        counts[pt] = counts.get(pt, 0) + 1
        if pt in capture_types and pt not in caps:
            reader.start()
        if pt == PACK_MAP:
            v = reader.mappack()
            if label:
                print(f"    MapPack keys={sorted(v.keys())}")
                for k in ("objHash", "value", "offset1", "offset2", "loop", "index"):
                    if k in v:
                        s = str(v[k])
                        print(f"      {k} = {s[:120]}")
        elif pt == PACK_PERF_COUNTER:
            t = struct.unpack(">q", reader.need(8))[0]   # readLong
            on = reader.text()
            tt = reader.u8()
            data = reader.value()
            print(f"    PerfCounterPack time={t} obj={on} timetype={tt} "
                  f"keys={sorted(data.keys())[:8] if isinstance(data, dict) else data}")
        elif pt == PACK_ALERT:
            t = struct.unpack(">q", reader.need(8))[0]   # readLong
            lv = reader.u8()                             # readByte
            ot = reader.text()
            oh = struct.unpack(">i", reader.need(4))[0]  # readInt
            ti = reader.text()
            msg = reader.text()
            reader.value()                               # tags
            print(f"    AlertPack time={t} level={lv} objType={ot} objHash={oh} "
                  f"title={ti!r} msg={msg[:60]!r}")
        else:
            print(f"    (PackType={pt} — 파싱 생략, 스트림 중단)")
            break
        if reader.rec is not None:
            caps[pt] = reader.stop()
    return counts, caps


def save(name, data):
    os.makedirs(FIXDIR, exist_ok=True)
    p = os.path.join(FIXDIR, name)
    with open(p, "wb") as f:
        f.write(data)
    print(f"    => 픽스처 저장 {name} ({len(data)} bytes)")


def probe(session, label, cmd, body, capture=(), fixture=None):
    """새 소켓으로 명령 1개를 던지고 응답을 해석한다."""
    print(f"\n{label}")
    sock, r = reopen()
    send(sock, cmd, session, body)
    try:
        counts, caps = drain(r, label, capture_types=capture)
        print(f"    팩 타입별 수신: {counts if counts else '(없음)'}")
        if fixture:
            for pt, data in caps.items():
                save(fixture, data)
    except EOFError:
        print("    !! 응답 없이 연결 종료 (커맨드/파라미터 거부)")
        counts = {}
    finally:
        sock.close()
    return counts


def main():
    sock, r, session = login()
    print(f"로그인 OK (session={session})")
    sock.close()

    sock, r = reopen()
    objs = objects(sock, r, session)
    sock.close()
    for ot, oh, on in objs:
        print(f"  [obj] type={ot} hash={oh} name={on}")
    if not objs:
        print("오브젝트 0건 — 앱이 붙었는지 확인할 것")
        return 1

    obj_type = objs[0][0]
    hashes = [o[1] for o in objs]

    # ── 1. COUNTER_REAL_TIME_ALL : ASIS 방식 (objType + counter)
    body = bytes([PACK_MAP]) + L.w_decimal(2)
    body += L.w_text("objType") + bytes([L.V_TEXT]) + L.w_text(obj_type)
    body += L.w_text("counter") + bytes([L.V_TEXT]) + L.w_text("TPS")
    probe(session, f"[1] COUNTER_REAL_TIME_ALL — ASIS 방식 (objType={obj_type}, counter=TPS)",
          "COUNTER_REAL_TIME_ALL", body)

    # ── 2. COUNTER_REAL_TIME_ALL : NScouter 방식 (objHash 리스트)
    body = bytes([PACK_MAP]) + L.w_decimal(1)
    body += L.w_text("objHash") + w_list_decimal(hashes)
    probe(session, "[2] COUNTER_REAL_TIME_ALL — NScouter 방식 (objHash 리스트)",
          "COUNTER_REAL_TIME_ALL", body)

    # ── 3. ALERT_REAL_TIME : ASIS 방식 (loop + index + objType)
    body = bytes([PACK_MAP]) + L.w_decimal(3)
    body += L.w_text("loop") + bytes([L.V_DEC]) + L.w_decimal(0)
    body += L.w_text("index") + bytes([L.V_DEC]) + L.w_decimal(0)
    body += L.w_text("objType") + bytes([L.V_TEXT]) + L.w_text(obj_type)
    probe(session, f"[3] ALERT_REAL_TIME — ASIS 방식 (loop=0, index=0, objType={obj_type})",
          "ALERT_REAL_TIME", body, capture=(PACK_ALERT,), fixture="alert_pack.bin")

    # ── 4. ALERT_REAL_TIME : NScouter 방식 (빈 MapPack)
    probe(session, "[4] ALERT_REAL_TIME — NScouter 방식 (빈 MapPack)",
          "ALERT_REAL_TIME", L.w_mappack({}))

    return 0


if __name__ == "__main__":
    sys.exit(main())
