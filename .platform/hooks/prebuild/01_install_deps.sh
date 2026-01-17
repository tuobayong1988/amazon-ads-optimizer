#!/bin/bash
set -e
cd /var/app/staging
echo "Installing pnpm..."
npm install -g pnpm@10.4.1
echo "Installing dependencies with pnpm..."
pnpm install --no-frozen-lockfile
echo "Dependencies installed successfully"
