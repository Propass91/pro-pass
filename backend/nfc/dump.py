#!/usr/bin/env python3
import argparse
import binascii
import json
import os
import sys
from pathlib import Path


# Nomenclature PROPASS
PASS_OMEGA = [0xEF, 0x61, 0xA3, 0xD4, 0x8E, 0x2A]


def _project_root() -> Path:
    # backend/nfc/dump.py -> project root
    return Path(__file__).resolve().parent.parent.parent


def _vault_dir() -> Path:
    env = os.environ.get("PROPASS_VAULT_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return (_project_root() / "VAULT").resolve()


def _out_path() -> Path:
    env = os.environ.get("PROPASS_OUT_PATH")
    if env:
        return Path(env).expanduser().resolve()
    return _vault_dir() / "SOURCE_ZERO.bin"


def _print_json(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def _eprint(msg: str) -> None:
    try:
        sys.stderr.write(str(msg) + "\n")
        sys.stderr.flush()
    except Exception:
        pass


def _dump_from_vault(out_path: Path, include_hex: bool) -> int:
    if not out_path.exists():
        _print_json({"success": False, "error": "MISSING_VAULT_FILE", "out_path": str(out_path)})
        return 1
    if include_hex:
        data = out_path.read_bytes()
        _print_json({
            "success": True,
            "uid": None,
            "out_path": str(out_path),
            "dump_hex": binascii.hexlify(data).decode("ascii")
        })
        return 0
    _print_json({"success": True, "uid": None, "out_path": str(out_path)})
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="PROPASS NFC dump (Python engine)")
    parser.add_argument("--vault", default=None, help="Override VAULT directory")
    parser.add_argument("--out", default=None, help="Override output bin path")
    parser.add_argument("--stdout", action="store_true", help="Include dump_hex in JSON output")
    parser.add_argument("--from-vault", action="store_true", help="Only read existing VAULT/SOURCE_ZERO.bin")
    args = parser.parse_args()

    if args.vault:
        os.environ["PROPASS_VAULT_DIR"] = args.vault
    if args.out:
        os.environ["PROPASS_OUT_PATH"] = args.out

    vault = _vault_dir()
    out_path = _out_path()
    try:
        vault.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

    if args.from_vault:
        return _dump_from_vault(out_path, include_hex=bool(args.stdout))

    try:
        from smartcard.System import readers  # type: ignore
    except Exception as e:
        _print_json({"success": False, "error": "PYSCARD_MISSING", "message": str(e)})
        return 3

    r = readers()
    if not r:
        _eprint("[-] Materiel absent.")
        _print_json({"success": False, "error": "NO_READER"})
        return 2

    try:
        conn = r[0].createConnection()
        conn.connect()
    except Exception as e:
        _eprint(f"[-] Connexion lecteur impossible: {e}")
        _print_json({"success": False, "error": "READER_CONNECT_FAIL"})
        return 2

    _eprint("[+] GENESIS DUMP : Extraction de la structure...")
    full_matrix = bytearray()

    for sector in range(0, 16):
        _eprint(f"[*] Secteur {sector:02d} :")
        try:
            # Charger PASS_OMEGA (Clé B)
            conn.transmit([0xFF, 0x82, 0x00, 0x01, 0x06] + PASS_OMEGA)
            # Authentification Key B (0x61)
            _res, sw1, _sw2 = conn.transmit([
                0xFF, 0x86, 0x00, 0x00, 0x05,
                0x01, 0x00, sector * 4, 0x61, 0x01
            ])
        except Exception:
            sw1 = 0x00

        if sw1 == 0x90:
            for block in range(sector * 4, (sector * 4) + 4):
                try:
                    data, sw1_r, _sw2_r = conn.transmit([0xFF, 0xB0, 0x00, block, 16])
                    if sw1_r == 0x90 and data is not None:
                        full_matrix.extend(bytearray(data))
                    else:
                        full_matrix.extend([0x00] * 16)
                except Exception:
                    full_matrix.extend([0x00] * 16)
        else:
            _eprint("ECHEC (Verrouille)")
            full_matrix.extend([0x00] * 64)

    try:
        out_path.write_bytes(full_matrix)
    except Exception as e:
        _eprint(f"[-] Ecriture VAULT impossible: {e}")
        _print_json({"success": False, "error": "VAULT_WRITE_FAIL", "out_path": str(out_path)})
        return 1

    _eprint(f"[V] SOURCE_ZERO.bin generee ({len(full_matrix)} octets).")

    payload = {"success": True, "uid": None, "out_path": str(out_path)}
    if args.stdout:
        payload["dump_hex"] = binascii.hexlify(full_matrix).decode("ascii")
    _print_json(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
