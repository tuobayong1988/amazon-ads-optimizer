#!/bin/bash
set -eo pipefail
cd /var/app/staging

# v674: Install production dependencies if not pre-bundled
# mysql2 is marked as external in esbuild, so it must be available at runtime via node_modules
# .ebignore excludes node_modules from deployment package to keep it small
echo "v674: Checking dependencies..."

# Clean up disk space first to prevent issues
rm -rf /tmp/npm_install_output.log 2>/dev/null || true
find /tmp/ -type f -mtime +1 -delete 2>/dev/null || true
npm cache clean --force 2>/dev/null || true
journalctl --vacuum-time=1d 2>/dev/null || true
find /var/log/ -name "*.gz" -delete 2>/dev/null || true

# Report disk space
echo "v674: Disk space before deployment:"
df -h / | tail -1

# v674: Always clean and reinstall production dependencies
# .ebignore excludes node_modules from deployment package
# Staging dir may have stale node_modules from previous deployments
echo "v674: Cleaning stale node_modules and installing fresh dependencies..."
rm -rf node_modules 2>/dev/null || true
npm install --production --no-optional 2>&1 | tail -30
echo "v674: npm install completed"

# Verify installation succeeded
if [ -d "node_modules/mysql2" ] && [ -d "node_modules/drizzle-orm" ]; then
  echo "v674: Dependencies verified (mysql2 and drizzle-orm present)"
else
  echo "ERROR: npm install failed to provide required dependencies"
  echo "mysql2 exists: $(test -d node_modules/mysql2 && echo YES || echo NO)"
  echo "drizzle-orm exists: $(test -d node_modules/drizzle-orm && echo YES || echo NO)"
  ls -la node_modules/ 2>/dev/null | head -10
  exit 1
fi

echo "v674: Disk space after deployment:"
df -h / | tail -1
echo "v674: Predeploy complete"
