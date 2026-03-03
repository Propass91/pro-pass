from smartcard.System import readers
import os

PASS_OMEGA  = [0xEF, 0x61, 0xA3, 0xD4, 0x8E, 0x2A]
SOURCE_PATH = os.environ.get("PROPASS_SOURCE_PATH",
              os.path.join(os.path.dirname(__file__), "..", "..", "VAULT", "SOURCE_ZERO.bin"))

def main():
    if not os.path.exists(SOURCE_PATH):
        return print(f"[-] Erreur : {SOURCE_PATH} absent.")

    r = readers()
    if not r:
        return print("[-] Materiel absent.")

    conn = r[0].createConnection()
    # Fix protocole Gen2 Magic - T1 requis pour AUTH MIFARE
    _ok = False
    for _p in [2, 1, 3, 4, 65536]:
        try:
            conn.connect(_p)
            _ok = True
            break
        except Exception:
            try:
                conn = r[0].createConnection()
            except Exception:
                pass
    if not _ok:
        return print("[-] Connexion lecteur impossible")

    with open(SOURCE_PATH, "rb") as f:
        matrix = f.read()

    print("[+] SYNC PRO ALPHA : Mise a jour Gen2 Magic (bloc 0 inclus)...")

    for sector in range(16):
        base_block = sector * 4
        print(f"[*] Secteur {sector:02d} :", end=" ")

        # Auth Cle B PASS_OMEGA
        conn.transmit([0xFF, 0x82, 0x00, 0x01, 0x06] + PASS_OMEGA)
        _, sw1, sw2 = conn.transmit([0xFF, 0x86, 0x00, 0x00, 0x05,
                                     0x01, 0x00, base_block, 0x61, 0x01])
        if sw1 == 0x90:
            print("AUTH OK ->", end=" ")
            for i in range(3):   # blocs 0, 1, 2 (pas le trailer)
                block = base_block + i
                # Gen2 Magic : bloc 0 inscriptible (UID cloneable) - PAS DE SKIP
                data  = list(matrix[block * 16 : block * 16 + 16])
                _, sw1_w, _ = conn.transmit([0xFF, 0xD6, 0x00, block, 16] + data)
                print(f"B{block}:{'W' if sw1_w == 0x90 else 'X'}", end=" ")
            print()
        else:
            print("ECHEC AUTH")

    print("\n[V] SYNCHRONISATION TERMINEE.")

if __name__ == "__main__":
    main()
