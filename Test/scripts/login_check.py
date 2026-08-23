# Scouter Collector LOGIN 핸드셰이크 검증
# 참조: src-tauri/src/scouter/{connection,codec,pack,value,protocol}.rs
import socket, struct, hashlib, sys

MAGIC = 0xCAFE2001
SALT = "qwertyuiop!@#$%^&*()zxcvbnm,."
PACK_MAP = 10
PACK_OBJECT = 80
V_BOOL, V_DEC, V_TEXT = 10, 20, 50
F_HAS_NEXT, F_NO_NEXT = 0x03, 0x04


def w_blob(b: bytes) -> bytes:
    n = len(b)
    if n == 0:
        return b"\x00"
    if n <= 253:
        return bytes([n]) + b
    if n <= 65535:
        return b"\xff" + struct.pack(">H", n) + b
    return b"\xfe" + struct.pack(">i", n) + b


def w_text(s: str) -> bytes:
    return w_blob(s.encode("utf-8"))


def w_decimal(v: int) -> bytes:
    if v == 0:
        return b"\x00"
    if -128 <= v <= 127:
        return b"\x01" + struct.pack(">b", v)
    if -32768 <= v <= 32767:
        return b"\x02" + struct.pack(">h", v)
    if -8388608 <= v <= 8388607:
        return b"\x03" + struct.pack(">i", v)[1:]
    if -2147483648 <= v <= 2147483647:
        return b"\x04" + struct.pack(">i", v)
    return b"\x08" + struct.pack(">q", v)


def w_mappack(d: dict) -> bytes:
    out = bytes([PACK_MAP]) + w_decimal(len(d))
    for k, (t, v) in d.items():
        out += w_text(k)
        out += bytes([t])
        if t == V_TEXT:
            out += w_text(v)
        elif t == V_DEC:
            out += w_decimal(v)
        elif t == V_BOOL:
            out += b"\x01" if v else b"\x00"
    return out


class R:
    def __init__(self, sock):
        self.s = sock
        self.buf = b""

    def need(self, n):
        while len(self.buf) < n:
            chunk = self.s.recv(65536)
            if not chunk:
                raise EOFError("연결 종료")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def u8(self):
        return self.need(1)[0]

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
            b = self.need(3)
            v = int.from_bytes(b, "big")
            return v - (1 << 24) if v & 0x800000 else v
        if ln == 4:
            return struct.unpack(">i", self.need(4))[0]
        if ln == 5:
            b = self.need(5)
            v = int.from_bytes(b, "big")
            return v - (1 << 40) if v & (1 << 39) else v
        return struct.unpack(">q", self.need(8))[0]

    def value(self):
        t = self.u8()
        if t == 0:
            return None
        if t == V_BOOL:
            return self.u8() == 1
        if t == V_DEC:
            return self.decimal()
        if t == V_TEXT:
            return self.text()
        if t == 30:
            return struct.unpack(">f", self.need(4))[0]
        if t == 40:
            return struct.unpack(">d", self.need(8))[0]
        if t == 60:
            return self.blob()
        if t == 70:
            return [self.value() for _ in range(self.decimal())]
        if t == 80:
            return {self.text(): self.value() for _ in range(self.decimal())}
        raise ValueError(f"미지원 ValueType: {t}")

    def mappack(self):
        return {self.text(): self.value() for _ in range(self.decimal())}


def main(host, port, user, pw):
    pw_hash = hashlib.sha256((SALT + pw).encode()).hexdigest()
    s = socket.create_connection((host, port), timeout=5)
    s.sendall(struct.pack(">I", MAGIC))

    param = {
        "id": (V_TEXT, user),
        "pass": (V_TEXT, pw_hash),
        "version": (V_TEXT, "Nscouter-1.0"),
        "hostname": (V_TEXT, "verify-host"),
        "isSocks": (V_BOOL, False),
        "socksIp": (V_TEXT, ""),
        "socksPort": (V_DEC, 0),
    }
    s.sendall(w_text("LOGIN") + struct.pack(">q", 0) + w_mappack(param))

    r = R(s)
    result = None
    while True:
        flag = r.u8()
        if flag == F_NO_NEXT:
            break
        if flag == F_HAS_NEXT:
            pt = r.u8()
            if pt == PACK_MAP:
                result = r.mappack()
            else:
                print(f"  (PackType={pt} 수신)")
        else:
            print(f"예상치 못한 TcpFlag: 0x{flag:02X}")
            return 2

    if not result:
        print("실패: 로그인 응답 MapPack 없음")
        return 2

    session = result.get("session", 0)
    print(f"session   = {session}")
    print(f"server_id = {result.get('server_id')}")
    print(f"error     = {result.get('error')}")
    print(f"keys      = {sorted(result.keys())}")
    if not session:
        print("=> 로그인 실패")
        return 1

    print("=> 로그인 성공")

    # 이어서 오브젝트 목록 조회
    # 커맨드명은 scouter.common 의 RequestCmd.OBJECT_LIST_REAL_TIME 이다.
    # (NScouter 는 "GET_OBJECT_LIST_REAL_TIME" 을 보내는데, 그런 커맨드는 없어서
    #  콜렉터가 응답 없이 TCP 연결을 끊는다 — R10)
    s.sendall(w_text("OBJECT_LIST_REAL_TIME") + struct.pack(">q", session) + w_mappack({}))
    n = 0
    try:
        while True:
            flag = r.u8()
            if flag == F_NO_NEXT:
                break
            if flag == F_HAS_NEXT:
                pt = r.u8()
                if pt == PACK_OBJECT:
                    # ObjectPack 은 XLogPack 과 달리 Blob 래핑 없이 필드가 그대로 이어진다.
                    # 순서: objType, objHash, objName, address, version, alive, wakeup, tags
                    obj_type = r.text()
                    obj_hash = r.decimal()
                    obj_name = r.text()
                    address = r.text()
                    version = r.text()
                    alive = r.u8() == 1
                    r.decimal()   # wakeup
                    r.value()     # tags (MapValue)
                    print(f"  [obj] name={obj_name} type={obj_type} "
                          f"hash={obj_hash} addr={address} ver={version} alive={alive}")
                elif pt == PACK_MAP:
                    r.mappack()
                else:
                    print(f"  (PackType={pt})")
                n += 1
            else:
                print(f"  예상치 못한 TcpFlag: 0x{flag:02X}")
                break
        print(f"=> OBJECT_LIST_REAL_TIME 응답 pack 수 = {n}")
    except EOFError:
        print(f"=> OBJECT_LIST_REAL_TIME 응답 없이 연결 종료 (수신 pack {n}개)")

    s.close()
    return 0


if __name__ == "__main__":
    sys.exit(main("127.0.0.1", 6100, "admin", "admin"))
