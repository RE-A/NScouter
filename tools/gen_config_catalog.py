"""스카우터 공식 설정 문서 → 설정 카탈로그(TS) 생성기.

공식 문서(scouter.document/main/Configuration.md)는 `Configure.java` 원문을 옮긴 것이다.
항목마다 `@ConfigDesc("...")` 설명과 `//Network` 같은 구역 주석이 붙어 있다. 그걸 그대로 뽑는다.

    python tools/gen_config_catalog.py [Configuration.md 경로]

경로를 안 주면 공식 저장소 master 에서 받는다. 결과는
src/features/config/catalog/official.ts 에 쓴다 — **손으로 고치지 말 것.**
한국어 이름·설명은 따로 둔다(ko*.ts). 여기는 공식 원문만 담는다.
"""
import io
import json
import re
import sys
import urllib.request
from datetime import date
from pathlib import Path

URL = "https://raw.githubusercontent.com/scouter-project/scouter/master/scouter.document/main/Configuration.md"
OUT = Path(__file__).resolve().parent.parent / "src/features/config/catalog/official.ts"

SCOPES = [
    ("server", "## Server options", "## Java agent options"),
    ("java", "## Java agent options", "## Host agent options"),
    ("host", "## Host agent options", None),
]

# 이름에 `$` 가 들어가는 항목이 있다(`input_telegraf_$measurement$_enabled`). 빼면 그 항목을
# 건너뛰면서 설명이 다음 항목으로 밀린다 — 실제로 visitor_hourly_count_enabled 에 붙었다.
FIELD = re.compile(r"^\s*public\s+([\w.<>\[\]]+)\s+([\w$]+)\s*(?:=\s*(.*?))?\s*;")
SECTION = re.compile(r"^\s*//\s*([A-Za-z].*?)\s*$")
VTYPE = re.compile(r"@ConfigValueType\(\s*(?:value\s*=\s*)?ValueType\.(\w+)")
STRING = re.compile(r'"((?:\\.|[^"\\])*)"')
ESCAPES = {"n": "\n", "t": " ", '"': '"', "\\": "\\"}


def unescape(s: str) -> str:
    return re.sub(r"\\(.)", lambda m: ESCAPES.get(m.group(1), m.group(1)), s)


def java_strings(src: str) -> str:
    """`"a" + "b"` 처럼 이어 붙인 자바 문자열 리터럴을 풀어 하나로 만든다."""
    return "".join(unescape(m.group(1)) for m in STRING.finditer(src))


def closed(buf: str) -> bool:
    """문자열 밖에서 괄호가 닫혔는가"""
    rest = STRING.sub("", buf)
    return ")" in rest


def parse(block: str):
    lines = block.splitlines()
    section = "(구역 없음)"
    desc = None
    vtype = None
    i = 0
    items = []
    while i < len(lines):
        line = lines[i]
        m = SECTION.match(line)
        # 주석 처리된 코드(`//public File ...`)는 구역 이름이 아니다
        if m and not re.match(r"(public|private|protected)\b", m.group(1)) and "=" not in m.group(1):
            section = m.group(1)
            i += 1
            continue
        if "@ConfigDesc(" in line:
            buf = line[line.index("@ConfigDesc(") + len("@ConfigDesc("):]
            while not closed(buf) and i + 1 < len(lines):
                i += 1
                buf += "\n" + lines[i]
            desc = java_strings(buf)
            # 같은 줄에 필드가 이어지는 일은 없지만, ValueType 이 같은 줄에 있을 수 있다
            m2 = VTYPE.search(buf)
            if m2:
                vtype = m2.group(1)
            i += 1
            continue
        m = VTYPE.search(line)
        if m:
            vtype = m.group(1)
            i += 1
            continue
        m = FIELD.match(line)
        if m:
            jtype, name, default = m.group(1), m.group(2), (m.group(3) or "").strip()
            if default.startswith('"') and default.endswith('"'):
                default = java_strings(default)
            item = {
                "key": name,
                "section": section,
                "type": jtype,
                "default": default,
                "desc": (desc or "").strip(),
            }
            if vtype:
                item["valueType"] = vtype
            items.append(item)
            desc = None
            vtype = None
        i += 1
    return items


def main():
    if len(sys.argv) > 1:
        text = io.open(sys.argv[1], encoding="utf-8").read()
    else:
        text = urllib.request.urlopen(URL).read().decode("utf-8")
    out = {}
    for scope, start, end in SCOPES:
        a = text.index(start)
        b = text.index(end) if end else len(text)
        out[scope] = parse(text[a:b])

    body = json.dumps(out, ensure_ascii=False, indent=2)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        "// 스카우터 공식 설정 문서에서 뽑은 원문 — **손으로 고치지 말 것.**\n"
        "//\n"
        f"// 출처: {URL}\n"
        f"// 생성: tools/gen_config_catalog.py ({date.today().isoformat()})\n"
        "//\n"
        "// 공식 문서는 `Configure.java` 원문이다. 설명은 필드의 `@ConfigDesc`, 구역은 `//Network`\n"
        "// 같은 주석이다. 한국어 이름·설명은 `ko*.ts` 에 따로 둔다 — 여기는 원문만 담는다.\n\n"
        "import type { OfficialCatalog } from './types';\n\n"
        f"export const OFFICIAL: OfficialCatalog = {body};\n",
        encoding="utf-8",
    )
    for k, v in out.items():
        print(k, len(v), "개")


if __name__ == "__main__":
    main()
