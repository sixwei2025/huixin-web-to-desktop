#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$DIR/WebShell.swift"
OUT="$DIR/WebShell.bin"

echo "[build_shell] Compiling native macOS WKWebView shell..."
swiftc -O -parse-as-library -suppress-warnings \
  -framework Cocoa -framework WebKit -framework Network \
  "$SRC" -o "$OUT" 2>/dev/null || \
swiftc -O \
  -framework Cocoa -framework WebKit -framework Network \
  "$SRC" -o "$OUT"

chmod +x "$OUT"
SIZE_KB=$(du -k "$OUT" | awk '{print $1}')
echo "[build_shell] ✅ Built $OUT (${SIZE_KB} KB)"
