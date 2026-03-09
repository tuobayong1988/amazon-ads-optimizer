#!/bin/bash
set -e
echo "=== Setting up .npmrc for legacy-peer-deps ==="
# Copy .npmrc to webapp user's home directory so npm reads it
cp /var/app/staging/.npmrc /home/webapp/.npmrc 2>/dev/null || true
chown webapp:webapp /home/webapp/.npmrc 2>/dev/null || true
# Also set it globally just in case
npm config set legacy-peer-deps true 2>/dev/null || true
echo "=== .npmrc setup complete ==="
cat /home/webapp/.npmrc 2>/dev/null || echo "(.npmrc not found, skipped)"
