#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT_DIR=${1:-"$ROOT_DIR/dist/pages"}

case "$OUT_DIR" in
  ""|"/") echo "refusing unsafe output directory: $OUT_DIR" >&2; exit 64;;
esac

rm -rf -- "$OUT_DIR"
mkdir -p -- "$OUT_DIR" "$OUT_DIR/catalog"
cp -R "$ROOT_DIR/landing/." "$OUT_DIR/"
rm -f -- "$OUT_DIR/README.md"
cp "$ROOT_DIR/deploy/runtime-config.pages.js" "$OUT_DIR/runtime-config.js"
cp "$ROOT_DIR/catalog/2026-2027-semester-1.json" "$OUT_DIR/catalog/2026-2027-semester-1.json"
node "$ROOT_DIR/tools/generate-elective-catalog.mjs" "$OUT_DIR/elective-catalog.generated.js"
sed -i '/<script src="\.\/runtime-config\.js"><\/script>/i\    <script src="./elective-catalog.generated.js"></script>' "$OUT_DIR/index.html"
sed -i '/<script src="\.\.\/runtime-config\.js"><\/script>/i\  <script src="../elective-catalog.generated.js"></script>' "$OUT_DIR/manage/index.html"
sed -i '/<script type="module" src="\.\/app\.js"><\/script>/i\    <script src="./trial-personalization.js"></script>' "$OUT_DIR/index.html"
sed -i '/<script type="module" src="\.\/app\.js"><\/script>/i\    <script src="./acquisition-ui.js"></script>' "$OUT_DIR/index.html"
sed -i '/<script type="module" src="\.\/app\.js"><\/script>/i\    <script src="./acquisition-ux-refinements.js"></script>' "$OUT_DIR/index.html"
sed -i '/<script type="module" src="\.\/app\.js"><\/script>/i\    <script type="module" src="./referral-sharing.js"></script>' "$OUT_DIR/index.html"
sed -i '/<script type="module" src="\.\/manage\.js"><\/script>/i\  <script src="./elective-empty-state.js"></script>' "$OUT_DIR/manage/index.html"
sed -i '/<script type="module" src="\.\/manage\.js"><\/script>/i\  <script type="module" src="../referral-sharing.js"></script>' "$OUT_DIR/manage/index.html"
sed -i '/<\/body>/i\    <script src="./availability-status.js"></script>' "$OUT_DIR/index.html"
: > "$OUT_DIR/.nojekyll"

if grep -R -n -E 'containerapps\.ru|/api/v2|file:///' "$OUT_DIR" >/dev/null 2>&1; then
  echo "legacy runtime reference detected in Pages artifact" >&2
  exit 1
fi
printf '%s\n' "$OUT_DIR"
