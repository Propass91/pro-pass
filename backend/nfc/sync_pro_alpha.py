from __future__ import annotations

import json
import os
import sys
from typing import List, Optional, Tuple

try:
    from smartcard.System import readers
except Exception as e:
    print(json.dumps({"success": False, "error": "PYSCARD_MISSING", "detail": str(e)}))
    raise


PASS_OMEGA: List[int] = [0xEF, 0x61, 0xA3, 0xD4, 0x8E, 0x2A]


def _env_source_path() -> str:
    explicit = os.environ.get("PROPASS_SOURCE_PATH")
    if explicit:
        return explicit

    vault = os.environ.get("PROPASS_VAULT_DIR")
    if vault:
        return os.path.join(vault, "SOURCE_ZERO.bin")

    # Dev fallback (project relative)
    return os.path.join("..", "VAULT", "SOURCE_ZERO.bin")


def _get_uid(conn) -> Optional[str]:
    # ACR122U: FF CA 00 00 00 -> UID
    try:
        res, sw1, sw2 = conn.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00])
        if sw1 == 0x90:
            return "".join(f"{b:02x}" for b in res)
    except Exception:
        return None
    return None


def main() -> int:
    source_path = _env_source_path()
    if not os.path.exists(source_path):
        print(json.dumps({"success": False, "error": "NO_DUMP", "path": source_path}))
        return 2

    with open(source_path, "rb") as f:
        matrix = f.read()

    if len(matrix) < 1024:
        print(json.dumps({"success": False, "error": "DUMP_TOO_SMALL", "size": len(matrix)}))
        return 2

    r = readers()
    if not r:
        print(json.dumps({"success": False, "error": "NO_READER"}))
        return 3

    conn = r[0].createConnection()
    conn.connect()
    uid = _get_uid(conn)

    blocks_written = 0
    blocks_failed = 0

    # Load key in volatile slot 0x01 (Key B)
    conn.transmit([0xFF, 0x82, 0x00, 0x01, 0x06] + PASS_OMEGA)

    for sector in range(0, 16):
        base_block = sector * 4

        # Authenticate using Key B (0x61) in slot 0x01
        _res, sw1, _sw2 = conn.transmit([0xFF, 0x86, 0x00, 0x00, 0x05, 0x01, 0x00, base_block, 0x61, 0x01])
        if sw1 != 0x90:
            blocks_failed += 3
            continue

        # Blocks 0,1,2 only (skip trailer)
        for i in range(3):
            block = base_block + i
            if sector == 0 and i == 0:
                # Block 0 contains UID/manufacturer
                continue

            start = block * 16
            data = list(matrix[start : start + 16])
            _rw, sw1w, _sw2w = conn.transmit([0xFF, 0xD6, 0x00, block, 16] + data)
            if sw1w == 0x90:
                blocks_written += 1
            else:
                blocks_failed += 1

    print(
        json.dumps(
            {
                "success": True,
                "uid": uid,
                "blocks_written": blocks_written,
                "blocks_failed": blocks_failed,
                "source_path": source_path,
            }
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:
        print(json.dumps({"success": False, "error": "WRITE_FAILED", "detail": str(e)}))
        raise
