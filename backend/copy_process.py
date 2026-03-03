import json, os, sys, time

PASS_OMEGA = [0xEF, 0x61, 0xA3, 0xD4, 0x8E, 0x2A]

def log(msg):
    sys.stdout.write(str(msg) + "\n"); sys.stdout.flush()

def jprint(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n"); sys.stdout.flush()

def transmit(conn, apdu, label=""):
    data, sw1, sw2 = conn.transmit(apdu)
    if not (sw1 == 0x90 and sw2 == 0x00):
        raise RuntimeError(f"{label} SW={sw1:02X}{sw2:02X}")
    return data

def auth_sector(conn, sector, key, key_type, slot=0x01):
    first = sector * 4
    load = [0xFF, 0x82, 0x00, slot, 0x06] + key
    transmit(conn, load, "LOAD_KEY")
    auth = [0xFF, 0x86, 0x00, 0x00, 0x05, 0x01, 0x00, first, key_type, slot]
    transmit(conn, auth, "AUTH")

def auth_sector_smart(conn, sector, pass_omega):
    DEFAULT = [0xFF] * 6
    for k, kt in [(pass_omega, 0x61), (DEFAULT, 0x61), (DEFAULT, 0x60)]:
        try:
            auth_sector(conn, sector, k, kt)
            return "PASS_OMEGA" if k == pass_omega else ("DEFAULT_B" if kt == 0x61 else "DEFAULT_A")
        except Exception:
            continue
    raise RuntimeError(f"AUTH impossible sector {sector}: tous echoues")

def connect_reader(reader, retries=5):
    for attempt in range(retries):
        conn = reader.createConnection()
        for proto in [2, 1, 3, 4, 65536]:
            try:
                conn.connect(proto)
                return conn
            except Exception:
                continue
        log(f"[WARN] Tentative connexion {attempt+1}/{retries}...")
        time.sleep(0.5)
    raise RuntimeError("READER_CONNECT_FAIL")

def patch_trailer(trailer_bytes, key_b):
    """
    MIFARE Classic ne retourne jamais les vraies clés (lues comme 00 00 00 00 00 00).
    On doit réinjecter PASS_OMEGA en position Key B avant l'écriture,
    sinon la carte sera verrouillée avec la clé 000000000000.
    Structure trailer: [KeyA 6B][AccessBits 4B][KeyB 6B]
    """
    t = list(trailer_bytes)
    for i, b in enumerate(key_b):
        t[10 + i] = b   # bytes 10-15 = Key B
    return t

def main():
    vault = os.environ.get("PROPASS_VAULT_DIR") or ""
    src   = os.environ.get("PROPASS_SOURCE_PATH") or ""
    if not src and vault:
        src = os.path.join(vault, "SOURCE_ZERO.bin")
    if not src:
        src = os.path.join(os.path.dirname(__file__), "..", "VAULT", "SOURCE_ZERO.bin")
    if not os.path.exists(src):
        log("ECHEC: DUMP INTROUVABLE")
        jprint({"success": False, "error": "NO_DUMP", "source_path": src}); return 2
    dump = open(src, "rb").read()[:1024]
    if len(dump) < 1024:
        log(f"ECHEC: DUMP TROP PETIT ({len(dump)} bytes)")
        jprint({"success": False, "error": "DUMP_TOO_SMALL"}); return 2

    try:
        from smartcard.System import readers
    except Exception as e:
        log("ECHEC: pyscard non disponible")
        jprint({"success": False, "error": "PYSCARD_MISSING", "details": str(e)}); return 2

    rlist = readers()
    if not rlist:
        log("ECHEC: AUCUN LECTEUR PC/SC")
        jprint({"success": False, "error": "NO_READER"}); return 2
    reader = rlist[0]
    log(f"Lecteur: {reader}")

    try:
        conn = connect_reader(reader)
    except Exception as e:
        log(f"ECHEC: CONNEXION LECTEUR ({e})")
        jprint({"success": False, "error": "READER_CONNECT", "details": str(e)}); return 2

    try:
        uid_bytes = transmit(conn, [0xFF, 0xCA, 0x00, 0x00, 0x00], "GET_UID")
        uid = "".join(f"{b:02X}" for b in uid_bytes)
        log(f"UID: {uid}")
    except Exception as e:
        log(f"ECHEC: LECTURE UID ({e})")
        jprint({"success": False, "error": "UID_READ", "details": str(e)}); return 2

    written = failed = skipped = 0

    for sector in range(16):
        first = sector * 4

        # ── AUTH secteur ───────────────────────────────────────────────────
        try:
            key_used = auth_sector_smart(conn, sector, PASS_OMEGA)
            log(f"Secteur {sector:02d}: AUTH OK ({key_used})")
        except Exception as e:
            log(f"Secteur {sector:02d}: ECHEC AUTH ({e})")
            jprint({"success": False, "error": "AUTH_FAIL",
                    "sector": sector, "uid": uid, "details": str(e)}); return 3

        # ── Blocs données 0-2 ──────────────────────────────────────────────
        for i in range(3):
            block = first + i

            # ⚠️ CRITIQUE : NE PAS envoyer d'APDU sur le bloc 0 (fabricant).
            # Un APDU de write refusé (SW=6300) sur ce bloc réinitialise
            # l'état d'authentification de la carte → AUTH_FAIL sur tous les
            # secteurs suivants.  On skip SANS émettre la commande.
            if sector == 0 and i == 0:
                log(f"  Bloc 00: SKIP (fabricant, accès en lecture seule - ACB protège)")
                skipped += 1
                continue

            chunk = list(dump[block * 16:(block + 1) * 16])
            try:
                transmit(conn, [0xFF, 0xD6, 0x00, block, 0x10] + chunk, f"WRITE_B{block:02d}")
                written += 1
                log(f"  Bloc {block:02d}: WRITE OK")
            except Exception as e:
                failed += 1
                log(f"  Bloc {block:02d}: ECHEC WRITE ({e})")
                # Re-auth après tout échec d'écriture pour restaurer l'état
                try:
                    auth_sector_smart(conn, sector, PASS_OMEGA)
                    log(f"  Secteur {sector:02d}: RE-AUTH OK")
                except Exception as re_err:
                    log(f"  Secteur {sector:02d}: RE-AUTH FAIL ({re_err})")

        # ── Trailer (bloc 3) ───────────────────────────────────────────────
        trailer_block = first + 3
        trailer_raw   = dump[trailer_block * 16:(trailer_block + 1) * 16]

        # Réinjecter PASS_OMEGA en Key B (octets 10-15) avant écriture
        trailer_patched = patch_trailer(trailer_raw, PASS_OMEGA)

        # Re-auth juste avant le trailer pour être sûr
        try:
            auth_sector_smart(conn, sector, PASS_OMEGA)
        except Exception:
            pass

        try:
            transmit(conn, [0xFF, 0xD6, 0x00, trailer_block, 0x10] + trailer_patched,
                     f"TRAILER_S{sector:02d}")
            log(f"  Trailer S{sector:02d}: OK")
        except Exception as e:
            log(f"  Trailer S{sector:02d}: ECHEC ({e})")

        time.sleep(0.03)

    log("OK: ECRITURE TERMINEE")
    jprint({"success": True, "uid": uid,
            "blocks_written": written, "blocks_failed": failed,
            "blocks_skipped": skipped, "source_path": src})
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log("ECHEC: INTERRUPTED")
        jprint({"success": False, "error": "INTERRUPTED"}); sys.exit(130)
    except Exception as e:
        log(f"ECHEC: {e}")
        jprint({"success": False, "error": "UNHANDLED", "details": str(e)}); sys.exit(2)
