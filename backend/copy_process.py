import json
import os
import sys
import time


def log(line: str) -> None:
    sys.stdout.write(str(line) + "\n")
    sys.stdout.flush()


def jprint(obj) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def sw_ok(resp) -> bool:
    if not resp or len(resp) < 2:
        return False
    sw1, sw2 = resp[-2], resp[-1]
    return sw1 == 0x90 and sw2 == 0x00


def transmit(connection, apdu, label: str = ""):
    data, sw1, sw2 = connection.transmit(apdu)
    ok = (sw1 == 0x90 and sw2 == 0x00)
    if not ok:
        raise RuntimeError(f"{label} SW={sw1:02X}{sw2:02X}")
    return data


def main() -> int:
    # Source dump path comes from Electron.
    vault_dir = os.environ.get("PROPASS_VAULT_DIR") or ""
    source_path = os.environ.get("PROPASS_SOURCE_PATH") or ""
    if not source_path and vault_dir:
        source_path = os.path.join(vault_dir, "SOURCE_ZERO.bin")

    if not source_path or not os.path.exists(source_path):
        log("ECHEC: DUMP INTROUVABLE")
        jprint({"success": False, "error": "NO_DUMP", "source_path": source_path})
        return 2

    dump = open(source_path, "rb").read()
    if len(dump) < 1024:
        log(f"ECHEC: DUMP TROP PETIT ({len(dump)} bytes)")
        jprint({"success": False, "error": "DUMP_TOO_SMALL", "size": len(dump), "source_path": source_path})
        return 2

    dump = dump[:1024]

    try:
        from smartcard.System import readers
    except Exception as e:
        log("ECHEC: pyscard non disponible")
        jprint({"success": False, "error": "PYSCARD_MISSING", "details": str(e)})
        return 2

    rlist = readers()
    if not rlist:
        log("ECHEC: AUCUN LECTEUR PC/SC")
        jprint({"success": False, "error": "NO_READER"})
        return 2

    reader = rlist[0]
    log(f"Lecteur: {reader}")

    connection = reader.createConnection()
    try:
        connection.connect()
    except Exception as e:
        log("ECHEC: IMPOSSIBLE DE SE CONNECTER AU LECTEUR")
        jprint({"success": False, "error": "READER_CONNECT", "details": str(e)})
        return 2

    # Read card UID (verifiable interaction)
    uid = None
    try:
        uid_bytes = transmit(connection, [0xFF, 0xCA, 0x00, 0x00, 0x00], "GET_UID")
        uid = "".join(f"{b:02X}" for b in uid_bytes)
        log(f"UID: {uid}")
    except Exception as e:
        log(f"ECHEC: LECTURE UID ({e})")
        jprint({"success": False, "error": "UID_READ", "details": str(e)})
        return 2

    # PASS_OMEGA key B (6 bytes) — keep consistent with backend/nfc/sync_pro_alpha.py
    key_b = [0xEF, 0x61, 0xA3, 0xD4, 0x8E, 0x2A]

    # Load key into volatile reader key slot 0x01 (Key B)
    try:
        transmit(connection, [0xFF, 0x82, 0x00, 0x01, 0x06] + key_b, "LOAD_KEY")
        log("Key slot 01: OK")
    except Exception as e:
        log(f"ECHEC: LOAD KEY ({e})")
        jprint({"success": False, "error": "LOAD_KEY", "details": str(e), "uid": uid})
        return 2

    blocks_written = 0
    blocks_failed = 0

    # MIFARE Classic 1K: 16 sectors, 4 blocks each.
    for sector in range(16):
        first_block = sector * 4
        # Authenticate sector (Key B, slot 0x01)
        # FF 86 00 00 05 01 00 <block> 61 <keySlot>
        try:
            transmit(connection, [0xFF, 0x86, 0x00, 0x00, 0x05, 0x01, 0x00, first_block, 0x61, 0x01], f"AUTH_S{sector:02d}")
            log(f"Secteur {sector:02d} : AUTH OK")
        except Exception as e:
            log(f"Secteur {sector:02d} : ECHEC AUTH ({e})")
            jprint({"success": False, "error": "AUTH_FAIL", "sector": sector, "uid": uid})
            return 3

        # Write data blocks (skip manufacturer block 0, skip trailer blocks)
        for block in range(first_block, first_block + 3):
            if block == 0:
                log("Bloc 00 : SKIP")
                continue

            start = block * 16
            chunk = dump[start:start + 16]
            if len(chunk) != 16:
                log(f"Bloc {block:02d} : ECHEC (taille)")
                blocks_failed += 1
                jprint({"success": False, "error": "DUMP_SLICE", "block": block, "uid": uid})
                return 4

            try:
                transmit(connection, [0xFF, 0xD6, 0x00, block, 0x10] + list(chunk), f"WRITE_B{block:02d}")
                blocks_written += 1
                log(f"Bloc {block:02d} : WRITE OK")
            except Exception as e:
                blocks_failed += 1
                log(f"Bloc {block:02d} : ECHEC WRITE ({e})")
                jprint({"success": False, "error": "WRITE_FAIL", "block": block, "sector": sector, "uid": uid})
                return 5

        # Small pacing helps some readers/cards
        time.sleep(0.02)

    log("OK: ECRITURE TERMINEE")
    jprint({
        "success": True,
        "uid": uid,
        "blocks_written": blocks_written,
        "blocks_failed": blocks_failed,
        "source_path": source_path,
    })
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log("ECHEC: INTERRUPTED")
        jprint({"success": False, "error": "INTERRUPTED"})
        sys.exit(130)
    except Exception as e:
        log(f"ECHEC: {e}")
        jprint({"success": False, "error": "UNHANDLED", "details": str(e)})
        sys.exit(2)
