#!/usr/bin/env bash
# Đóng gói extension thành zip để tải lên Chrome Web Store.
# Chỉ gồm file chạy được; không gồm tests/, store/, scripts/, README.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./manifest.json').version")"
OUT_DIR="dist"
OUT_FILE="$OUT_DIR/group-post-dedup-$VERSION.zip"
FILES=(
  manifest.json
  core.js
  auction-core.js
  content.js
  comment-block.js
  profile-block.js
  auction.js
  background.js
  auction-sweep.js
  content.css
  popup.html
  popup.css
  popup.js
  auctions.html
  auctions.css
  auctions.js
  icons/icon16.png
  icons/icon48.png
  icons/icon128.png
)

for file in "${FILES[@]}"; do
  [ -f "$file" ] || { echo "Thiếu file: $file" >&2; exit 1; }
done

node --test tests/*.test.js >/dev/null

mkdir -p "$OUT_DIR"
rm -f "$OUT_FILE"
zip -q -X "$OUT_FILE" "${FILES[@]}"

echo "Đã tạo $OUT_FILE"
unzip -l "$OUT_FILE"
