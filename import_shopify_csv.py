#!/usr/bin/env python3
"""
Importa el archivo CSV oficial exportado desde Shopify Admin
(Productos -> Exportar -> Todos los productos -> CSV para Excel/Numbers)
y actualiza automáticamente data.js + catalog_backup.json de la nueva tienda Panacea.

Uso:
  python3 import_shopify_csv.py ruta/a/products_export.csv
"""
import csv
import html as html_mod
import json
import re
import sys
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent


def clean_html(s):
    if not s:
        return ""
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</p>|</li>|</div>|</h[1-6]>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = html_mod.unescape(s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def smart_category(handle, title, ptype, tags):
    blob = f"{handle} {title} {ptype} {tags}".lower()
    if "kit" in blob or "ritual" in blob:
        return "kits"
    if any(k in blob for k in ["bebé", "bebe", "rozadura", "lanolina", "talco"]):
        return "bebe"
    if any(k in blob for k in ["shampoo", "capilar", "cabello"]):
        return "capilar"
    if any(k in blob for k in ["tónico", "tonico", "agua de", "agua enzim", "agua azufr"]):
        return "tonicos"
    if any(k in blob for k in ["desodorante", "barba", "karit", "respira", "árnica", "arnica", "derma", "higié"]):
        return "higienicos"
    if any(k in blob for k in ["corporal", "aromaterapia", "stretch", "venot", "desintox", "descontract"]):
        return "corporal"
    return "facial"


def smart_concerns(title, desc, tags):
    blob = f"{title} {desc} {tags}".lower()
    c = []
    if any(k in blob for k in ["acné", "acne", "azufre", "grasa", "poro", "brote"]):
        c.append("acne")
    if any(k in blob for k in ["mancha", "vitamina c", "regaliz", "tono", "paño", "luminos"]):
        c.append("manchas")
    if any(k in blob for k in ["arruga", "firmeza", "anti-edad", "antiedad", "colágeno", "melatonina", "ojera", "líneas"]):
        c.append("antiedad")
    if any(k in blob for k in ["sensible", "caléndula", "calendula", "bebé", "aloe", "rosas", "atópic", "dermatitis"]):
        c.append("sensible")
    return c or ["sensible"]


def import_csv(csv_path: Path):
    grouped = {}
    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            handle = (row.get("Handle") or "").strip()
            if not handle or handle == "test":
                continue
            status = (row.get("Status") or "active").strip().lower()
            if status and status != "active" and handle not in grouped:
                continue

            if handle not in grouped:
                grouped[handle] = {
                    "handle": handle,
                    "title": (row.get("Title") or "").strip(),
                    "body": clean_html(row.get("Body (HTML)") or ""),
                    "type": (row.get("Type") or "").strip(),
                    "tags": (row.get("Tags") or "").strip(),
                    "images": [],
                    "variants": [],
                }
            g = grouped[handle]
            if row.get("Title") and not g["title"]:
                g["title"] = row["Title"].strip()
            if row.get("Body (HTML)") and not g["body"]:
                g["body"] = clean_html(row["Body (HTML)"])

            img = (row.get("Image Src") or "").strip()
            if img and img not in g["images"]:
                g["images"].append(img)

            price_raw = (row.get("Variant Price") or "").strip()
            if price_raw:
                try:
                    price = float(price_raw)
                except ValueError:
                    price = 0.0
                cmp_raw = (row.get("Variant Compare At Price") or "").strip()
                cmp_price = float(cmp_raw) if cmp_raw else None
                opt1 = (row.get("Option1 Value") or "").strip()
                opt2 = (row.get("Option2 Value") or "").strip()
                vname = " / ".join(x for x in [opt1, opt2] if x and x.lower() != "default title") or "Estándar"
                g["variants"].append({
                    "name": vname,
                    "price": price,
                    "comparePrice": cmp_price,
                    "sku": (row.get("Variant SKU") or "").strip(),
                    "grams": int(float(row.get("Variant Grams") or 0)),
                    "inventory": int(float(row.get("Variant Inventory Qty") or 10)),
                    "available": True,
                })

    # Load existing backup to preserve articles/pages/testimonials
    backup_path = WEB_DIR / "catalog_backup.json"
    existing = json.loads(backup_path.read_text(encoding="utf-8")) if backup_path.exists() else {}

    products = []
    for h, g in grouped.items():
        if not g["variants"]:
            continue
        prices = [v["price"] for v in g["variants"] if v["price"] > 0]
        if not prices:
            continue
        base_price = min(prices)
        cmp_prices = [v["comparePrice"] for v in g["variants"] if v.get("comparePrice") and v["comparePrice"] > base_price]
        cat = smart_category(h, g["title"], g["type"], g["tags"])
        desc = g["body"]
        sub = desc.split(".")[0].strip() if desc else (g["type"] or "Fórmula botánica 100% natural")
        if len(sub) > 88:
            sub = sub[:85].rsplit(" ", 1)[0] + "…"

        products.append({
            "id": h,
            "title": g["title"] or h,
            "subtitle": sub,
            "category": cat,
            "productType": g["type"],
            "concerns": smart_concerns(g["title"], desc, g["tags"]),
            "price": base_price,
            "comparePrice": cmp_prices[0] if cmp_prices else None,
            "available": True,
            "bestSeller": "best" in g["tags"].lower() or cat == "kits",
            "badge": "Kit Ritual" if cat == "kits" else "100% Natural",
            "rating": 4.9,
            "reviews": 0,
            "image": g["images"][0] if g["images"] else "",
            "hoverImage": g["images"][1] if len(g["images"]) > 1 else (g["images"][0] if g["images"] else ""),
            "gallery": g["images"][:6],
            "description": desc,
            "accordions": {},
            "variants": g["variants"] if len(g["variants"]) > 1 else [],
        })

    existing["products"] = products
    backup_path.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    (WEB_DIR / "data.js").write_text(
        "// Importado desde CSV oficial de Shopify\nwindow.PANACEA_DATA = " + json.dumps(existing, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    print(f"OK! Importados {len(products)} productos activos a data.js y catalog_backup.json")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python3 import_shopify_csv.py ruta/al/products_export.csv")
        sys.exit(1)
    import_csv(Path(sys.argv[1]))
