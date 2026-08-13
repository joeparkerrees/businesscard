#!/usr/bin/env bash
# Copy the card into the portfolio's public/card and rewrite its asset paths.
#
# The two copies differ in exactly one way: here every reference is relative,
# and there every reference is absolute (/card/...). That is not cosmetic — at
# /card with no trailing slash a relative URL resolves against the domain root
# and every asset 404s. Doing the rewrite by hand each time is how the two
# copies drift, so it lives here.
#
# Usage:  scripts/sync-to-portfolio.sh [path-to-newportfolio]

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORTFOLIO="${1:-/workspace/newportfolio}"
DEST="$PORTFOLIO/public/card"

[ -d "$PORTFOLIO" ] || { echo "No portfolio checkout at $PORTFOLIO" >&2; exit 1; }

rm -rf "$DEST"
mkdir -p "$DEST"

cd "$SRC"
cp index.html styles.css card.js favicon.svg qr-url.svg qr-vcard.svg "$DEST"/
cp joe-parker-rees.vcf "$DEST"/
cp -r vendor "$DEST"/
mkdir -p "$DEST/fonts"
# Octave only — Romie was dropped from the design, so don't ship it.
cp fonts/Octave-Regular.woff2 "$DEST/fonts/"
[ -f relief.png ] && cp relief.png "$DEST"/ || true

# Use sed in a cross-platform way (macOS vs GNU)
SED_I=(sed -i)
if [[ "$OSTYPE" == "darwin"* ]]; then
  SED_I=(sed -i '')
fi

"${SED_I[@]}" \
  -e 's|href="fonts/|href="/card/fonts/|g' \
  -e 's|href="favicon.svg"|href="/card/favicon.svg"|' \
  -e 's|href="styles.css"|href="/card/styles.css"|' \
  -e 's|"./vendor/three.module.min.js"|"/card/vendor/three.module.min.js"|' \
  -e 's|src="qr-url.svg"|src="/card/qr-url.svg"|' \
  -e 's|data-qr="qr-|data-qr="/card/qr-|g' \
  -e 's|src="card.js"|src="/card/card.js"|' \
  "$DEST/index.html"

"${SED_I[@]}" "s|url('fonts/|url('/card/fonts/|g" "$DEST/styles.css"

"${SED_I[@]}" \
  -e "s|'./vendor/|'/card/vendor/|g" \
  -e "s|'relief.png'|'/card/relief.png'|" \
  -e "s|'qr-url.svg':|'/card/qr-url.svg':|" \
  -e "s|'qr-vcard.svg':|'/card/qr-vcard.svg':|" \
  "$DEST/card.js"

# Verify relative asset references are rewritten
if python3 -c '
import sys, re
content = open(sys.argv[1]).read()
unrewritten = re.findall(r"(?:href|src)=\"(?!/card|mailto:|https?:|data:)[^\"]+\"", content)
if unrewritten:
    print("Relative asset references found:", unrewritten)
    sys.exit(1)
' "$DEST/index.html"; then
  :
else
  exit 1
fi

echo "Synced to $DEST"
find "$DEST" -type f | sed "s|$DEST/||" | sort

