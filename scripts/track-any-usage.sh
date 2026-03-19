#!/bin/bash
# TypeScript 'any' Usage Tracker
# Tracks the number of 'any' declarations across the codebase
# Used in CI/CD to prevent regression and encourage gradual cleanup

set -e

echo "📊 TypeScript 'any' Usage Report"
echo "================================="
echo ""

# Security-critical files (MUST be 0)
SECURITY_FILES=(
  "server/utils/accessControl.ts"
  "server/_core/trpc.ts"
  "server/_core/sdk.ts"
  "server/_core/context.ts"
  "server/system/localAuthService.ts"
  "server/system/inviteCodeService.ts"
  "server/utils/dbRLS.ts"
)

echo "🔒 Security-Critical Files (MUST be 0 'any'):"
SECURITY_TOTAL=0
SECURITY_FAILED=false
for f in "${SECURITY_FILES[@]}"; do
  if [ -f "$f" ]; then
    COUNT=$(grep -c ": any\|as any\|<any>" "$f" 2>/dev/null || true)
    COUNT=${COUNT:-0}
    if [ -z "$COUNT" ] || ! [[ "$COUNT" =~ ^[0-9]+$ ]]; then COUNT=0; fi
    SECURITY_TOTAL=$((SECURITY_TOTAL + COUNT))
    if [ "$COUNT" -gt 0 ]; then
      echo "  ❌ $f: $COUNT 'any' declarations"
      SECURITY_FAILED=true
    else
      echo "  ✅ $f: 0"
    fi
  fi
done
echo ""

# Overall codebase count
echo "📈 Overall Codebase 'any' Count:"
CLIENT_COUNT=$(grep -rn ": any\|as any\|<any>" client/src/ --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l || echo "0")
SERVER_COUNT=$(grep -rn ": any\|as any\|<any>" server/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v "_archived" | wc -l || echo "0")
TOTAL=$((CLIENT_COUNT + SERVER_COUNT))

echo "  Client: $CLIENT_COUNT"
echo "  Server: $SERVER_COUNT"
echo "  Total:  $TOTAL"
echo ""

# Baseline threshold (current count - should decrease over time)
BASELINE=3300
if [ "$TOTAL" -gt "$BASELINE" ]; then
  echo "⚠️  WARNING: 'any' count ($TOTAL) exceeds baseline ($BASELINE)!"
  echo "   New code is introducing more 'any' declarations."
  echo "   Please use proper types instead of 'any'."
fi

# CI enforcement for security files
if [ "${CI:-false}" = "true" ] && [ "$SECURITY_FAILED" = "true" ]; then
  echo ""
  echo "❌ CI FAILURE: Security-critical files contain 'any' declarations!"
  echo "   These files MUST have 0 'any' for security compliance."
  exit 1
fi

echo ""
echo "✅ 'any' usage tracking complete."
