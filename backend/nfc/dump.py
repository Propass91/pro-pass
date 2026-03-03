#!/usr/bin/env python3
import sys, os, json, argparse

PASS_OMEGA = [0xEF, 0x61, 0xA3, 0xD4, 0x8E, 0x2A]

def _e(*a, **k): print(*a, file=sys.stderr, **k); sys.stderr.flush()

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--vault', default=None)
    p.add_argument('--out',   default=None)
    p.add_argument('--stdout', action='store_true')
    p.add_argument('--from-vault', action='store_true')
    a = p.parse_args()

    vd = os.path.abspath(a.vault or os.environ.get('PROPASS_VAULT_DIR') or
         os.path.join(os.path.dirname(__file__), '..', '..', 'VAULT'))
    os.makedirs(vd, exist_ok=True)
    op = os.path.abspath(a.out or os.environ.get('PROPASS_OUT_PATH') or
         os.path.join(vd, 'SOURCE_ZERO.bin'))

    if a.from_vault:
        if not os.path.exists(op):
            print(json.dumps({"success": False, "error": "VAULT_NOT_FOUND"})); return
        print(json.dumps({"success": True, "uid": None, "out_path": op,
                          "dump_hex": open(op,'rb').read().hex()})); return

    try:
        from smartcard.System import readers as R
    except ImportError:
        print(json.dumps({"success": False, "error": "PYSCARD_MISSING", "code": 3})); return

    rl = R()
    if not rl:
        print(json.dumps({"success": False, "error": "NO_READER", "code": 1})); return

    conn = rl[0].createConnection()
    try:
        conn.connect()
    except Exception as ex:
        print(json.dumps({"success": False, "error": "CONNECT_FAILED", "detail": str(ex), "code": 2})); return

    uid = None
    try:
        ud, sw1, _ = conn.transmit([0xFF,0xCA,0x00,0x00,0x00])
        if sw1 == 0x90: uid = "".join(f"{b:02X}" for b in ud)
    except: pass

    _e(f"[+] UID: {uid}")
    _e("[+] GENESIS DUMP")

    fm = bytearray()
    for s in range(16):
        fb = s * 4
        _e(f"[*] S{s:02d}:", end=" ")
        conn.transmit([0xFF,0x82,0x00,0x01,0x06]+PASS_OMEGA)
        _, sw1, _ = conn.transmit([0xFF,0x86,0x00,0x00,0x05,0x01,0x00,fb,0x61,0x01])
        if sw1 == 0x90:
            _e("OMEGA OK", end=" ")
            for b in range(fb, fb+4):
                d, sw, _ = conn.transmit([0xFF,0xB0,0x00,b,16])
                fm.extend(d if sw==0x90 else [0]*16)
                _e(f"B{b}:{'OK' if sw==0x90 else 'ERR'}", end=" ")
            _e()
        else:
            conn.transmit([0xFF,0x82,0x00,0x00,0x06,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF])
            _, sw2, _ = conn.transmit([0xFF,0x86,0x00,0x00,0x05,0x01,0x00,fb,0x60,0x00])
            if sw2 == 0x90:
                _e("KeyA OK", end=" ")
                for b in range(fb, fb+4):
                    d, sw, _ = conn.transmit([0xFF,0xB0,0x00,b,16])
                    fm.extend(d if sw==0x90 else [0]*16)
                    _e(f"B{b}:{'OK' if sw==0x90 else 'ERR'}", end=" ")
                _e()
            else:
                _e("ECHEC"); fm.extend([0]*64)

    open(op,'wb').write(fm)
    _e(f"[V] {len(fm)} octets -> {op}")
    print(json.dumps({"success": True, "uid": uid, "out_path": op, "dump_hex": fm.hex()}))
    sys.stdout.flush()

if __name__ == "__main__":
    main()
