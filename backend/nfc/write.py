from smartcard.System import readers
import os

# Nomenclature PROPASS - badges avec clé PASS_OMEGA
PASS_OMEGA = [0xEF, 0x61, 0xA3, 0xD4, 0x8E, 0x2A]
SOURCE_PATH = os.environ.get(
    "PROPASS_SOURCE_PATH",
    os.path.join(os.path.dirname(__file__), "..", "..", "VAULT", "SOURCE_ZERO.bin")
)


def get_data_block(matrix: bytes, sector: int, block_index: int, compact_768: bool) -> list:
    if compact_768:
        start = ((sector * 3) + block_index) * 16
    else:
        block = (sector * 4) + block_index
        start = block * 16
    return list(matrix[start:start + 16])


def main():
    if not os.path.exists(SOURCE_PATH):
        print(f"[-] Erreur : {SOURCE_PATH} absent.")
        return 1

    r = readers()
    if not r:
        print("[-] Materiel absent.")
        return 1

    conn = r[0].createConnection()
    try:
        conn.connect()
    except Exception:
        print("[-] Connexion lecteur impossible")
        return 1

    with open(SOURCE_PATH, "rb") as f:
        matrix = f.read()

    matrix_len = len(matrix)
    compact_768 = matrix_len == 768
    full_1024 = matrix_len >= 1024

    if not compact_768 and not full_1024:
        print(f"[-] Dump invalide: taille {matrix_len} bytes (attendu 768 ou >=1024)")
        return 1

    if compact_768:
        print("[i] Dump compact détecté (768 bytes)")

    print("[+] SYNC PRO ALPHA : Mise a jour des supports actifs...")

    had_auth = False
    had_write = False
    had_write_fail = False
    failed_sectors = []

    for sector in range(0, 16):
        print(f"[*] Secteur {sector:02d} :", end=" ")
        base_block = sector * 4

        try:
            conn.transmit([0xFF, 0x82, 0x00, 0x01, 0x06] + PASS_OMEGA)
            _, sw1, _ = conn.transmit([
                0xFF, 0x86, 0x00, 0x00, 0x05,
                0x01, 0x00, base_block, 0x61, 0x01
            ])
        except Exception:
            sw1 = 0x00

        if sw1 == 0x90:
            had_auth = True
            print("AUTH OK ->", end=" ")
            for i in range(3):
                block = base_block + i

                if sector == 0 and i == 0:
                    data = get_data_block(matrix, sector, i, compact_768)
                    try:
                        _, sw1_w, _ = conn.transmit([0xFF, 0xD6, 0x00, 0, 16] + data)
                    except Exception:
                        sw1_w = 0x00
                    if sw1_w == 0x90:
                        had_write = True
                        print("B0:W", end=" ")
                    else:
                        print("B0:SKIP", end=" ")
                    continue

                data = get_data_block(matrix, sector, i, compact_768)

                try:
                    _, sw1_w, _ = conn.transmit([0xFF, 0xD6, 0x00, block, 16] + data)
                except Exception:
                    sw1_w = 0x00

                if sw1_w == 0x90:
                    had_write = True
                    print(f"B{block}:W", end=" ")
                else:
                    had_write_fail = True
                    print(f"B{block}:X", end=" ")
            print()
        else:
            print("ECHEC AUTH (Verifier le support)")
            failed_sectors.append(sector)

    print("\n[V] SYNCHRONISATION TERMINEE.")

    if not had_auth:
        return 1
    if not had_write:
        return 1
    if had_write_fail:
        return 1
    if failed_sectors:
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
