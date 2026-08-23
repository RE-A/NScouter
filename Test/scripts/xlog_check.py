# Scouter Collector 실시간 XLog 수신 검증
# 에이전트 → 콜렉터 → 클라이언트 경로 전체가 동작하는지 확인한다.
#
# 커맨드명은 scouter.common 의 RequestCmd 를, XLogPack 필드 순서는
# scouter.lang.pack.XLogPack.read() 를 근거로 한다.
import socket
import struct
import hashlib
import sys

import login_check as L

V_LIST = 70
PACK_XLOG = 21


def w_list_decimal(values):
    out = bytes([V_LIST]) + L.w_decimal(len(values))
    for v in values:
        out += bytes([L.V_DEC]) + L.w_decimal(v)
    return out


def w_param(obj_hashes, loop_val, index, count=10000):
    """
    scouter.webapp 의 XLogConsumer.handleRealTimeXLog() 와 동일한 파라미터 구성.
    키 이름은 ParamConstant 에서 확인: objHash / loop / index / count
    """
    out = bytes([L.PACK_MAP]) + L.w_decimal(4)
    out += L.w_text("objHash") + w_list_decimal(obj_hashes)
    out += L.w_text("loop") + bytes([L.V_DEC]) + L.w_decimal(loop_val)
    out += L.w_text("index") + bytes([L.V_DEC]) + L.w_decimal(index)
    out += L.w_text("count") + bytes([L.V_DEC]) + L.w_decimal(count)
    return out


def read_xlog(reader):
    """XLogPack 은 전체가 Blob 으로 감싸져 있다."""
    body = reader.blob()
    d = L.R(None)
    d.buf = body

    def dec():
        return d.decimal()

    def lng():
        return struct.unpack(">q", d.need(8))[0]

    x = {
        "endTime": dec(),
        "objHash": dec(),
        "service": dec(),
        "txid": lng(),
        "caller": lng(),
        "gxid": lng(),
        "elapsed": dec(),
        "error": dec(),
        "cpu": dec(),
        "sqlCount": dec(),
        "sqlTime": dec(),
    }
    x["ipaddr"] = ".".join(str(b) for b in d.blob())
    return x


def connect(host, port):
    """매직 넘버까지 보낸 새 연결. 콜렉터는 연결당 명령 1개만 처리한다."""
    s = socket.create_connection((host, port), timeout=10)
    s.sendall(struct.pack(">I", L.MAGIC))
    return s, L.R(s)


def main(host, port, user, pw):
    # ── 1. 로그인 (전용 연결)
    pw_hash = hashlib.sha256((L.SALT + pw).encode()).hexdigest()
    s, r = connect(host, port)
    param = {
        "id": (L.V_TEXT, user),
        "pass": (L.V_TEXT, pw_hash),
        "version": (L.V_TEXT, "Nscouter-1.0"),
        "hostname": (L.V_TEXT, "xlog-check"),
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
    print(f"로그인 성공 (server_id={res.get('server_id')})")

    # ── 2. 오브젝트 목록 (새 연결)
    s, r = connect(host, port)
    s.sendall(L.w_text("OBJECT_LIST_REAL_TIME") + struct.pack(">q", session) + L.w_mappack({}))
    hashes = []
    while True:
        flag = r.u8()
        if flag == L.F_NO_NEXT:
            break
        if flag != L.F_HAS_NEXT:
            break
        if r.u8() == L.PACK_OBJECT:
            obj_type = r.text()
            obj_hash = r.decimal()
            obj_name = r.text()
            r.text()          # address
            r.text()          # version
            r.u8()            # alive
            r.decimal()       # wakeup
            r.value()         # tags
            hashes.append(obj_hash)
            print(f"  대상 에이전트: {obj_name} (type={obj_type}, hash={obj_hash})")
    s.close()

    if not hashes:
        print("에이전트 없음 — XLog 조회 불가")
        return 1

    # ── 3. 실시간 XLog 조회 (새 연결)
    s, r = connect(host, port)
    s.sendall(L.w_text("TRANX_REAL_TIME_GROUP_LATEST")
              + struct.pack(">q", session) + w_param(hashes, 0, 0))

    xlogs = []
    cursor = None
    while True:
        flag = r.u8()
        if flag == L.F_NO_NEXT:
            break
        if flag != L.F_HAS_NEXT:
            print(f"  예상치 못한 TcpFlag: 0x{flag:02X}")
            break
        pt = r.u8()
        if pt == PACK_XLOG:
            xlogs.append(read_xlog(r))
        elif pt == L.PACK_MAP:
            cursor = r.mappack()
        else:
            print(f"  (PackType={pt})")

    print(f"\n=> XLog 수신: {len(xlogs)}건")
    print(f"=> 커서 MapPack: {cursor}")

    if xlogs:
        by_obj = {}
        errors = 0
        gxid_linked = 0
        for x in xlogs:
            by_obj[x["objHash"]] = by_obj.get(x["objHash"], 0) + 1
            if x["error"] != 0:
                errors += 1
            if x["caller"] != 0:
                gxid_linked += 1

        print(f"=> objHash 별 건수: {by_obj}")
        print(f"=> error != 0 : {errors}건")
        print(f"=> caller != 0 (분산 트랜잭션 하위): {gxid_linked}건")
        el = sorted(x["elapsed"] for x in xlogs)
        print(f"=> elapsed 분포: min={el[0]}ms  median={el[len(el) // 2]}ms  max={el[-1]}ms")

        print("\n샘플 5건:")
        for x in xlogs[:5]:
            print(f"  objHash={x['objHash']:>12} elapsed={x['elapsed']:>6}ms "
                  f"error={x['error']:>3} sqlCount={x['sqlCount']:>3} "
                  f"gxid={x['gxid']} caller={x['caller']}")

    s.close()
    return 0 if xlogs else 2


if __name__ == "__main__":
    sys.exit(main("127.0.0.1", 6100, "admin", "admin"))
