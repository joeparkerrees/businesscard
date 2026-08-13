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
cp -r vendor models "$DEST"/
mkdir -p "$DEST/fonts"
# Octave only — Romie was dropped from the design, so don't ship it.
cp fonts/Octave-Regular.woff2 "$DEST/fonts/"
[ -f relief.png ] && cp relief.png "$DEST"/ || true

sed -i \
  -e 's|href="fonts/|href="/card/fonts/|g' \
  -e 's|href="favicon.svg"|href="/card/favicon.svg"|' \
  -e 's|href="styles.css"|href="/card/styles.css"|' \
  -e 's|"./vendor/three.module.min.js"|"/card/vendor/three.module.min.js"|' \
  -e 's|src="qr-url.svg"|src="/card/qr-url.svg"|' \
  -e 's|data-qr="qr-|data-qr="/card/qr-|g' \
  -e 's|src="card.js"|src="/card/card.js"|' \
  "$DEST/index.html"

sed -i "s|url('fonts/|url('/card/fonts/|g" "$DEST/styles.css"

sed -i \
  -e "s|'./vendor/|'/card/vendor/|g" \
  -e "s|'models/face.glb'|'/card/models/face.glb'|" \
  -e "s|'relief.png'|'/card/relief.png'|" \
  -e "s|'qr-url.svg':|'/card/qr-url.svg':|" \
  -e "s|'qr-vcard.svg':|'/card/qr-vcard.svg':|" \
  "$DEST/card.js"

# Fail loudly rather than shipping a page whose assets 404 in production.
if grep -qP '(href|src)="(?!/card|mailto:|https?:|data:)' "$DEST/index.html"; then
  echo "Relative asset reference survived the rewrite in index.html:" >&2
  grep -nP '(href|src)="(?!/card|mailto:|https?:|data:)' "$DEST/index.html" >&2
  exit 1
fi

echo "Synced to $DEST"
find "$DEST" -type f | sed "s|$DEST/||" | sort
