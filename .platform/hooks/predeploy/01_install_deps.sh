#!/bin/bash
set -eo pipefail
cd /var/app/staging

# v630: node_modules is pre-bundled in the deployment package
# No need to run npm install - just verify key modules exist
echo "v630: Verifying pre-bundled dependencies..."

# Clean up disk space first to prevent issues
rm -rf /tmp/npm_install_output.log 2>/dev/null || true
find /tmp/ -type f -mtime +1 -delete 2>/dev/null || true
npm cache clean --force 2>/dev/null || true
journalctl --vacuum-time=1d 2>/dev/null || true
find /var/log/ -name "*.gz" -delete 2>/dev/null || true

# Report disk space
echo "v630: Disk space before deployment:"
df -h / | tail -1

# Verify key modules exist
if [ -d "node_modules/mysql2" ] && [ -d "node_modules/drizzle-orm" ]; then
  echo "v630: Pre-bundled dependencies verified (mysql2 and drizzle-orm present)"
  exit 0
else
  echo "ERROR: Pre-bundled node_modules missing key dependencies"
  echo "mysql2 exists: $(test -d node_modules/mysql2 && echo YES || echo NO)"
  echo "drizzle-orm exists: $(test -d node_modules/drizzle-orm && echo YES || echo NO)"
  exit 1
fi
