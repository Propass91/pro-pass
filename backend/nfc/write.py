#!/usr/bin/env python3
import argparse
import binascii
import json
import os
import sys
from pathlib import Path


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _vault_dir() -> Path:
    env = os.environ.get("PROPASS_VAULT_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return (_project_root() / "VAULT").resolve()


def _in_path() -> Path:
    env = os.environ.get("PROPASS_IN_PATH")
    if env:
        return Path(env).expanduser().resolve()
    return _vault_dir() / "SOURCE_ZERO.bin"


def _print_json(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser(description="PROPASS NFC write (Python engine)")
    parser.add_argument("--vault", default=None, help="Override VAULT directory")
    parser.add_argument("--in", dest="in_path", default=None, help="Override input bin path")
    parser.add_argument("--hex", default=None, help="Provide dump as HEX (1024 bytes = 2048 hex)")
    args = parser.parse_args()

    if args.vault:
        os.environ["PROPASS_VAULT_DIR"] = args.vault
    if args.in_path:
        os.environ["PROPASS_IN_PATH"] = args.in_path

    vault = _vault_dir()
    in_path = _in_path()

    try:
        vault.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

    if args.hex:
        hex_str = "".join(ch for ch in str(args.hex) if ch.lower() in "0123456789abcdef")
        try:
            data = binascii.unhexlify(hex_str)
        except Exception:
            _print_json({"success": False, "error": "INVALID_HEX"})
            return 1
        in_path.write_bytes(data)

    if not in_path.exists():
        _print_json({"success": False, "error": "MISSING_INPUT", "in_path": str(in_path)})
        return 1

    # Paste your real write-to-card logic here.
    _print_json({
        "success": False,
        "error": "NO_READER",
        "message": "Python NFC write engine not implemented in this stub. Provide your existing write logic in backend/nfc/write.py",
        "vault": str(vault),
        "in_path": str(in_path)
    })
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
