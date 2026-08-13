#!/usr/bin/env python3
"""Generate the card's two QR codes as SVG, plus the downloadable vCard.

Run after changing CARD_URL (e.g. when moving to a custom domain):

    python3 scripts/gen-qr.py

Both QRs are baked at build time rather than generated in the browser, so the
page ships no QR library and draws no runtime cost.
"""

import pathlib
import qrcode

ROOT = pathlib.Path(__file__).resolve().parent.parent

# The URL the primary QR points at. The card is served from the portfolio's
# Vercel deploy at /card, so this must match the rewrite in newportfolio's
# next.config.ts. Re-run this script after changing it.
CARD_URL = "https://joeparkerrees.co.uk/card"

# Kept deliberately short: fewer characters means a lower-density QR, which
# matters because people scan this off a phone screen rather than off paper.
VCARD = "\r\n".join([
    "BEGIN:VCARD",
    "VERSION:3.0",
    "N:Parker-Rees;Joe",
    "FN:Joe Parker-Rees",
    "TITLE:Product Designer & Developer",
    "EMAIL:joe@joeparkerrees.com",
    "URL:https://joeparkerrees.co.uk",
    "END:VCARD",
    "",
])

DARK = "#00220A"


def to_svg(data: str, quiet: int = 2) -> str:
    """Render `data` as an SVG whose modules are merged into horizontal runs.

    Merging each row's consecutive dark modules into one <rect> keeps the file
    a few KB instead of one element per module.
    """
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=quiet)
    qr.add_data(data)
    qr.make(fit=True)
    matrix = qr.get_matrix()
    size = len(matrix)

    rects = []
    for y, row in enumerate(matrix):
        x = 0
        while x < size:
            if row[x]:
                run = x
                while run < size and row[run]:
                    run += 1
                rects.append(f'<rect x="{x}" y="{y}" width="{run - x}" height="1"/>')
                x = run
            else:
                x += 1

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        f'shape-rendering="crispEdges" role="img">'
        f'<rect width="{size}" height="{size}" fill="#FFFFFF"/>'
        f'<g fill="{DARK}">{"".join(rects)}</g>'
        f"</svg>"
    )


def main() -> None:
    targets = {
        "qr-url.svg": CARD_URL,
        "qr-vcard.svg": VCARD,
    }
    for name, payload in targets.items():
        path = ROOT / name
        path.write_text(to_svg(payload), encoding="utf-8")
        print(f"{name}: {path.stat().st_size} bytes")

    vcf = ROOT / "joe-parker-rees.vcf"
    vcf.write_text(VCARD, encoding="utf-8")
    print(f"{vcf.name}: {vcf.stat().st_size} bytes")


if __name__ == "__main__":
    main()
