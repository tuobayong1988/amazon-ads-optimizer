#!/bin/bash
set -e
cd /var/app/staging

# v449: Install production dependencies only
# dist/index.js is pre-built locally via esbuild, no build step needed on EB
echo "v449: Installing production dependencies..."
npm install --production --legacy-peer-deps 2>&1 | tail -10
echo "Dependencies installed successfully"
