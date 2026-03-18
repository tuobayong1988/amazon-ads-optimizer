#!/bin/bash
set -e
cd /var/app/staging

# v449: Install ALL dependencies (including devDependencies for esbuild build step)
# After build, dist/index.js is a self-contained bundle that doesn't need devDependencies at runtime
echo "v449: Installing all dependencies (including dev for esbuild build)..."
npm install --legacy-peer-deps 2>&1 | tail -10
echo "Dependencies installed successfully"
