# XLog 프로파일 실측 — 어떤 Step 타입이 실제로 오는지 확인한다.
#
#   python profile_check.py
#
# Step 필드 순서는 ASIS scouter.lang.step.* 의 read() 를 그대로 옮겼다.
# NScouter 의 profile.rs 와 대조하는 것이 목적이다.
import struct
import sys

import login_check as L
from capture_fixtures import Tap, login, objects, reopen, send, w_list_decimal

PACK_MAP = 10
PACK_XLOG = 21
PACK_PROFILE = 26   # PackEnum.XLOG_PROFILE
PACK_PROFILE2 = 27  # PackEnum.XLOG_PROFILE2 (분할 전송)

# StepEnum
STEP_NAMES = {
    1: "METHOD", 10: "METHOD2", 2: "SQL", 8: "SQL2", 16: "SQL3",
    3: "MESSAGE", 5: "SOCKET", 6: "APICALL", 15: "APICALL2",
    7: "THREAD_SUBMIT", 9: "HASHED_MESSAGE", 17: "PARAM_MESSAGE",
    12: "DUMP", 13: "DISPATCH", 14: "THREAD_CALL_POSSIBLE",
    51: "SPAN", 52: "SPANCALL", 99: "CONTROL",
}


class B:
    """바이트 버퍼 리더 (소켓이 아니라 blob 용)"""

    def __init__(self, buf):
        self.b = buf
        self.p = 0

    def left(self):
        return len(self.b) - self.p

    def need(self, n):
        out = self.b[self.p:self.p + n]
        if len(out) < n:
            raise EOFError("버퍼 끝")
        self.p += n
        return out

    def u8(self):
        return self.need(1)[0]

    def i8(self):
        return struct.unpack(">b", self.need(1))[0]

    def long(self):
        return struct.unpack(">q", self.need(8))[0]

    def blob(self):
        n = self.u8()
        if n == 0:
            return b""
        if n == 0xFF:
            n = struct.unpack(">H", self.need(2))[0]
        elif n == 0xFE:
            n = struct.unpack(">i", self.need(4))[0]
        return self.need(n)

    def text(self):
        return self.blob().decode("utf-8", "replace")

    def decimal(self):
        ln = self.u8()
        if ln == 0:
            return 0
        if ln == 1:
            return struct.unpack(">b", self.need(1))[0]
        if ln == 2:
            return struct.unpack(">h", self.need(2))[0]
        if ln == 3:
            v = int.from_bytes(self.need(3), "big")
            return v - (1 << 24) if v & 0x800000 else v
        if ln == 4:
            return struct.unpack(">i", self.need(4))[0]
        if ln == 5:
            v = int.from_bytes(self.need(5), "big")
            return v - (1 << 40) if v & (1 << 39) else v
        return struct.unpack(">q", self.need(8))[0]


def read_base(r):
    """StepSingle.read(): parent, index, start_time, start_cpu"""
    return (r.decimal(), r.decimal(), r.decimal(), r.decimal())


def read_step(r):
    """ASIS 필드 순서 그대로. 반환: (타입명, 요약dict)"""
    t = r.u8()
    name = STEP_NAMES.get(t, f"UNKNOWN({t})")

    if t == 99:  # StepControl extends StepSummary — base 없음
        return name, {"message": r.text(), "code": r.decimal()}

    base = read_base(r)
    d = {"parent": base[0], "index": base[1]}

    if t == 1:      # MethodStep
        d.update(hash=r.decimal(), elapsed=r.decimal(), cputime=r.decimal())
    elif t == 10:   # MethodStep2 = MethodStep + error
        d.update(hash=r.decimal(), elapsed=r.decimal(), cputime=r.decimal(),
                 error=r.decimal())
    elif t in (2, 8, 16):  # SqlStep / 2 / 3
        d.update(hash=r.decimal(), elapsed=r.decimal(), cputime=r.decimal(),
                 param=r.text(), error=r.decimal())
        if t in (8, 16):
            d["xtype"] = r.i8()
        if t == 16:
            d["updated"] = r.decimal()
    elif t == 3:    # MessageStep
        d.update(message=r.text())
    elif t == 9:    # HashedMessageStep
        d.update(hash=r.decimal(), time=r.decimal(), value=r.decimal())
    elif t == 17:   # ParameterizedMessageStep
        d.update(hash=r.decimal(), elapsed=r.decimal(), level=r.decimal(),
                 param=r.text())
    elif t == 5:    # SocketStep
        ip = r.blob()
        d.update(ip=".".join(str(x) for x in ip) if len(ip) == 4 else ip.hex(),
                 port=r.decimal(), elapsed=r.decimal(), error=r.decimal())
    elif t in (6, 15):  # ApiCallStep / 2
        d.update(txid=r.decimal(), hash=r.decimal(), elapsed=r.decimal(),
                 cputime=r.decimal(), error=r.decimal())
        opt = r.i8()
        d["opt"] = opt
        if opt == 1:
            d["address"] = r.text()
        if t == 15:
            d["async"] = r.i8()
    elif t == 13:   # DispatchStep
        d.update(txid=r.decimal(), hash=r.decimal(), elapsed=r.decimal(),
                 cputime=r.decimal(), error=r.decimal())
        opt = r.i8()
        d["opt"] = opt
        if opt == 1:
            d["address"] = r.text()
    elif t == 7:    # ThreadSubmitStep
        d.update(txid=r.decimal(), hash=r.decimal(), elapsed=r.decimal(),
                 cputime=r.decimal(), error=r.decimal())
    elif t == 14:   # ThreadCallPossibleStep
        d.update(txid=r.decimal(), hash=r.decimal(), elapsed=r.decimal(),
                 threaded=r.i8())
    else:
        raise ValueError(f"미구현 Step 타입 {t} — 본문 길이를 몰라 스트림 중단")
    return name, d


def main():
    sock, r, session = login()
    sock.close()

    sock, r = reopen()
    objs = objects(sock, r, session)
    sock.close()
    hashes = [o[1] for o in objs]

    # 1) 최신 XLog 몇 건 확보
    sock, r = reopen()
    body = bytes([PACK_MAP]) + L.w_decimal(4)
    body += L.w_text("objHash") + w_list_decimal(hashes)
    body += L.w_text("loop") + bytes([L.V_DEC]) + L.w_decimal(0)
    body += L.w_text("index") + bytes([L.V_DEC]) + L.w_decimal(0)
    body += L.w_text("count") + bytes([L.V_DEC]) + L.w_decimal(50)
    send(sock, "TRANX_REAL_TIME_GROUP_LATEST", session, body)

    xlogs = []
    while True:
        flag = r.u8()
        if flag == L.F_NO_NEXT:
            break
        pt = r.u8()
        if pt == PACK_XLOG:
            # XLogPack.read(): blob 안에 version 바이트 없이 endTime 부터 시작한다
            d = B(r.blob())
            end_time = d.decimal()
            objhash = d.decimal()
            d.decimal()                 # service
            txid = d.long()
            xlogs.append((txid, objhash, end_time))
        elif pt == PACK_MAP:
            r.mappack()
    sock.close()
    print(f"XLog {len(xlogs)}건 확보")
    if not xlogs:
        print("XLog 0건 — 부하가 도는지 확인할 것 (load.ps1)")
        return 1

    # 2) 프로파일 요청 — 여러 건 시도해 Step 타입 분포를 본다
    #
    # date 는 로컬 날짜가 아니라 **XLog 의 endTime 에서 뽑아야** 한다.
    # 콜렉터 DB 디렉토리가 그 기준이다 (/data/database/20260814).
    # 콜렉터 DB 디렉토리는 **콜렉터 타임존** 기준이고, 클라이언트는 로컬 날짜로 조회한다
    # (ASIS DateUtil.yyyymmdd 도 로컬). 둘이 다르면 프로파일이 조용히 0건이 되므로
    # 테스트 환경 콜렉터를 Asia/Seoul 로 맞춰뒀다 (collector/Containerfile).
    from datetime import datetime
    seen = {}
    parsed_ok = 0
    for txid, objhash, end_time in xlogs[:15]:
        day = datetime.fromtimestamp(end_time / 1000).strftime("%Y%m%d")
        sock, r = reopen()
        body = bytes([PACK_MAP]) + L.w_decimal(3)
        body += L.w_text("date") + bytes([L.V_TEXT]) + L.w_text(day)
        body += L.w_text("txid") + bytes([L.V_DEC]) + L.w_decimal(txid)
        body += L.w_text("max") + bytes([L.V_DEC]) + L.w_decimal(10000)
        send(sock, "TRANX_PROFILE", session, body)

        blob = None
        got = []
        try:
            while True:
                flag = r.u8()
                if flag == L.F_NO_NEXT:
                    break
                pt = r.u8()
                got.append(pt)
                if pt in (PACK_PROFILE, PACK_PROFILE2):
                    r.decimal()          # time
                    r.decimal()          # objHash
                    r.decimal()          # service
                    struct.unpack(">q", r.need(8))[0]   # txid (readLong)
                    chunk = r.blob()
                    blob = chunk if blob is None else blob + chunk
                else:
                    break
        except EOFError:
            got.append("EOF")
        sock.close()

        if not blob:
            if parsed_ok == 0:
                print(f"  txid={txid} date={day} → 수신 팩 {got}, blob 없음")
            continue

        b = B(blob)
        steps = []
        try:
            while b.left() > 0:
                steps.append(read_step(b))
        except (EOFError, ValueError) as e:
            print(f"  txid={txid} 파싱 중단: {e} (남은 {b.left()}B)")

        if steps:
            parsed_ok += 1
            for name, _ in steps:
                seen[name] = seen.get(name, 0) + 1
            if parsed_ok == 1:
                print(f"\n첫 프로파일 (txid={txid}, blob {len(blob)}B, step {len(steps)}개)")
                for name, d in steps[:12]:
                    print(f"  {name:16} {d}")

    print(f"\n프로파일 {parsed_ok}건 파싱 성공")
    print("Step 타입 분포:")
    for k, v in sorted(seen.items(), key=lambda x: -x[1]):
        print(f"  {k:20} {v}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
