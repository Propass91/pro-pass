#!/usr/bin/env python3
import json
import sys
import time


def _print(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _eprint(msg: str) -> None:
    try:
        sys.stderr.write(str(msg) + "\n")
        sys.stderr.flush()
    except Exception:
        pass


def _read_uid(card) -> str | None:
    try:
        conn = card.createConnection()
        conn.connect()
        data, sw1, sw2 = conn.transmit([0xFF, 0xCA, 0x00, 0x00, 0x00])
        if sw1 == 0x90 and sw2 == 0x00 and data:
            return ''.join(f"{b:02X}" for b in data)
    except Exception:
        return None
    finally:
        try:
            conn.disconnect()
        except Exception:
            pass
    return None


def main() -> int:
    try:
        from smartcard.System import readers
        from smartcard.CardMonitoring import CardMonitor, CardObserver
    except Exception:
        _print({"type": "error", "error": "PYSCARD_MISSING"})
        return 2

    try:
        r = readers()
        if not r:
            _print({"type": "error", "error": "NO_READER"})
            return 3
    except Exception:
        _print({"type": "error", "error": "NO_READER"})
        return 3

    class Observer(CardObserver):
        def update(self, observable, actions):
            addedcards, removedcards = actions
            for card in addedcards:
                uid = _read_uid(card)
                _print({"type": "present", "uid": uid})
            for _ in removedcards:
                _print({"type": "removed"})

    cm = CardMonitor()
    obs = Observer()
    cm.addObserver(obs)

    _print({"type": "ready"})
    try:
        while True:
            time.sleep(0.25)
    except KeyboardInterrupt:
        return 0
    finally:
        try:
            cm.deleteObserver(obs)
        except Exception:
            pass


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:
        _eprint(e)
        _print({"type": "error", "error": "WATCHER_CRASH"})
        raise SystemExit(1)
