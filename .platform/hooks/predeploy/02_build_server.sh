#!/bin/bash
set -e
cd /var/app/staging

echo "=== v449: Building server with esbuild ==="

# Check if esbuild is available
if [ -f "node_modules/.bin/esbuild" ]; then
  echo "esbuild found, running build-server.js..."
  node build-server.js
  
  if [ -f "dist/index.js" ]; then
    BUNDLE_SIZE=$(du -h dist/index.js | cut -f1)
    echo "✅ Server build completed! Bundle: dist/index.js ($BUNDLE_SIZE)"
  else
    echo "⚠️ Build completed but dist/index.js not found, falling back to tsx"
    exit 0
  fi
else
  echo "⚠️ esbuild not found in node_modules, falling back to tsx"
  exit 0
fi

echo "=== Build complete ==="
