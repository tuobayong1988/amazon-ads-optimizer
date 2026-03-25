#!/bin/bash
set -eo pipefail
cd /var/app/staging

# v519: Robust npm install with retry and proper error handling
# Previous v449 version used `npm install 2>&1 | tail -10` which masked errors
# due to pipefail not being set, causing silent deployment failures
MAX_RETRIES=3
RETRY_DELAY=10

for attempt in $(seq 1 $MAX_RETRIES); do
  echo "v519: Installing production dependencies (attempt $attempt/$MAX_RETRIES)..."
  
  if npm install --production --legacy-peer-deps 2>&1 | tee /tmp/npm_install_output.log | tail -20; then
    # Verify npm install actually succeeded by checking key modules exist
    if [ -d "node_modules/mysql2" ] && [ -d "node_modules/drizzle-orm" ]; then
      echo "Dependencies installed successfully (verified: mysql2 and drizzle-orm present)"
      exit 0
    else
      echo "WARNING: npm install appeared to succeed but key modules are missing"
      echo "mysql2 exists: $(test -d node_modules/mysql2 && echo YES || echo NO)"
      echo "drizzle-orm exists: $(test -d node_modules/drizzle-orm && echo YES || echo NO)"
    fi
  else
    echo "npm install failed on attempt $attempt"
    cat /tmp/npm_install_output.log | grep -i "error" | head -10
  fi
  
  if [ $attempt -lt $MAX_RETRIES ]; then
    echo "Retrying in ${RETRY_DELAY}s..."
    sleep $RETRY_DELAY
    RETRY_DELAY=$((RETRY_DELAY * 2))
  fi
done

echo "FATAL: npm install failed after $MAX_RETRIES attempts"
echo "Last npm output:"
cat /tmp/npm_install_output.log | tail -30
exit 1
