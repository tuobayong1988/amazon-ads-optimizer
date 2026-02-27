#!/bin/bash
set -e
cd /var/app/staging
echo "Installing production dependencies..."
npm install --production --no-optional --legacy-peer-deps 2>&1 | tail -5
echo "Dependencies installed successfully"
