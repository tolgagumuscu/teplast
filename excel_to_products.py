"""
excel_to_products.py
T.E. PLAST — Planlama Excel dosyasını products.json'a çevirir.

Kullanım:
  python3 excel_to_products.py "T.E Plast Planlama Denetim.xlsx"

Gerekli kütüphane:
  pip install openpyxl
"""

import json
import sys
import os
from pathlib import Path

try:
    import openpyxl
except ImportError:
    print("openpyxl gerekli: pip install openpyxl")
    sys.exit(1)

# ── Sütun haritası ─────────────────────────────────
# C (index 2) ve H (index 7) sütunları atlanıyor
COL_MAP = {
    0:  "müşteri",           # A
    1:  "müşteriKullanma",   # B
    # 2: C — atla
    3:  "parçaKodu",         # D
    4:  "parçaAdı",          # E
    5:  "kalıpGöz",          # F
    6:  "hammadde",          # G
    # 7: H — atla
    8:  "karışımOranı",      # I
    9:  "renkKodu",          # J
    10: "boyaOranı",         # K
    11: "netGram",           # L
    12: "brütGram",          # M
    13: "çevrimSüresi",      # N
    14: "sonrakiOperasyon",  # O
    15: "makineler",         # P
}

def cell_val(cell):
    if cell is None or cell.value is None:
        return None
    v = cell.value
    if isinstance(v, float):
        return int(v) if v == int(v) else round(v, 4)
    return str(v).strip() if str(v).strip() else None

def excel_to_json(excel_path):
    print(f"Okunuyor: {excel_path}")
    wb = openpyxl.load_workbook(excel_path, read_only=True, data_only=True)

    all_products = []
    stats = {}

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        rows = list(ws.iter_rows())
        if len(rows) < 2:
            continue

        # İlk satır başlık — atla
        skipped = 0
        sheet_products = []

        for row in rows[1:]:  # başlıktan sonra
            # Parça kodu yoksa atla (boş satır)
            parça_kodu_cell = row[3] if len(row) > 3 else None
            parça_adı_cell  = row[4] if len(row) > 4 else None
            parça_kodu = cell_val(parça_kodu_cell)
            parça_adı  = cell_val(parça_adı_cell)

            if not parça_kodu and not parça_adı:
                skipped += 1
                continue

            product = {"sheet": sheet_name}
            for col_idx, field_name in COL_MAP.items():
                if col_idx < len(row):
                    v = cell_val(row[col_idx])
                    if v is not None:
                        product[field_name] = v

            sheet_products.append(product)

        all_products.extend(sheet_products)
        stats[sheet_name] = len(sheet_products)
        print(f"  {sheet_name}: {len(sheet_products)} ürün")

    wb.close()

    # Arama için index oluştur: parçaKodu → product
    by_code = {}
    for p in all_products:
        code = p.get("parçaKodu")
        if code:
            by_code[str(code).upper().replace(" ","")] = p

    output = {
        "_info": "T.E. PLAST Ürün Veritabanı",
        "_generated": __import__('datetime').datetime.now().isoformat(),
        "_total": len(all_products),
        "_sheets": stats,
        "byCode": by_code,       # hızlı arama: "S00132" → product
        "products": all_products  # tam liste
    }

    # Çıktı dosyasını Excel ile aynı klasöre yaz
    out_path = Path(excel_path).parent / "products.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n✅ Toplam {len(all_products)} ürün → {out_path}")
    print(f"   Bu dosyayı: teplast-render/public/data/products.json olarak kopyala")
    return out_path

if __name__ == "__main__":
    if len(sys.argv) < 2:
        # Mevcut klasördeki ilk xlsx'i dene
        xlsx_files = list(Path(".").glob("*.xlsx")) + list(Path(".").glob("*.xls"))
        if not xlsx_files:
            print("Kullanım: python3 excel_to_products.py dosya.xlsx")
            sys.exit(1)
        excel_path = str(xlsx_files[0])
        print(f"Otomatik bulundu: {excel_path}")
    else:
        excel_path = sys.argv[1]

    if not os.path.exists(excel_path):
        print(f"Dosya bulunamadı: {excel_path}")
        sys.exit(1)

    excel_to_json(excel_path)
