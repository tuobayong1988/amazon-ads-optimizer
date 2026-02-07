#!/bin/bash
set -e

echo "[Predeploy] Starting build process..."

cd /var/app/staging

# Install pnpm if not available
if ! command -v pnpm &> /dev/null; then
    echo "[Predeploy] Installing pnpm..."
    npm install -g pnpm@10.4.1
fi

# Install dependencies (including devDependencies for build)
echo "[Predeploy] Installing dependencies..."
NODE_ENV=development pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Build the application
echo "[Predeploy] Building application..."
pnpm run build

echo "[Predeploy] Build completed successfully!"
ls -la dist/
