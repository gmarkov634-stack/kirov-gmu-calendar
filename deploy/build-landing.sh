#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT_DIR=${1:-"$ROOT_DIR/dist/kgmu"}

case "$OUT_DIR" in
  ""|"/")
    echo "refusing unsafe output directory: $OUT_DIR" >&2
    exit 64
    ;;
esac

rm -rf -- "$OUT_DIR"
mkdir -p -- "$OUT_DIR" "$OUT_DIR/catalog"

cp -R "$ROOT_DIR/landing/." "$OUT_DIR/"
cp "$ROOT_DIR/deploy/runtime-config.production.js" "$OUT_DIR/runtime-config.js"
cp "$ROOT_DIR/catalog/2026-2027-semester-1.json" "$OUT_DIR/catalog/2026-2027-semester-1.json"

if grep -R -n -E 'containerapps\.ru|/api/v2|file:///' "$OUT_DIR" >/dev/null 2>&1; then
  echo "legacy runtime reference detected in deploy artifact" >&2
  exit 1
fi

printf '%s\n' "$OUT_DIR"
