#!/bin/bash
# Schema Sync Verification Script
# Ensures all drizzle schema changes have corresponding migration files
# Usage: ./scripts/check-schema-sync.sh

set -e

echo "🔍 Checking Drizzle Schema Synchronization..."
echo ""

# Step 1: Count tables in schema vs migrations
SCHEMA_TABLES=$(grep 'mysqlTable("' drizzle/schema.ts | sed 's/.*mysqlTable("\([^"]*\)".*/\1/' | sort)
SCHEMA_COUNT=$(echo "$SCHEMA_TABLES" | wc -l)

MIGRATION_TABLES=$(grep -h "CREATE TABLE" drizzle/migrations/*.sql 2>/dev/null | sed 's/.*`\([^`]*\)`.*/\1/' | sort -u)
MIGRATION_COUNT=$(echo "$MIGRATION_TABLES" | wc -l)

echo "📊 Schema tables: $SCHEMA_COUNT"
echo "📊 Migration tables: $MIGRATION_COUNT"
echo ""

# Step 2: Find tables without migrations
MISSING_TABLES=$(comm -23 <(echo "$SCHEMA_TABLES") <(echo "$MIGRATION_TABLES"))
MISSING_COUNT=$(echo "$MISSING_TABLES" | grep -c "." || true)

if [ "$MISSING_COUNT" -gt 0 ]; then
  echo "⚠️  $MISSING_COUNT tables in schema without migration files:"
  echo "$MISSING_TABLES" | head -20
  if [ "$MISSING_COUNT" -gt 20 ]; then
    echo "  ... and $((MISSING_COUNT - 20)) more"
  fi
  echo ""
  echo "💡 Run 'npx drizzle-kit generate' to create migration files for new tables."
  echo "💡 Or use 'npx drizzle-kit push' for development environments."
  echo ""
fi

# Step 3: Check for recent schema changes without migrations
# Compare the last modified time of schema.ts vs the latest migration
SCHEMA_MTIME=$(stat -c %Y drizzle/schema.ts 2>/dev/null || echo "0")
LATEST_MIGRATION=$(ls -t drizzle/migrations/*.sql 2>/dev/null | head -1)

if [ -n "$LATEST_MIGRATION" ]; then
  MIGRATION_MTIME=$(stat -c %Y "$LATEST_MIGRATION" 2>/dev/null || echo "0")
  
  if [ "$SCHEMA_MTIME" -gt "$MIGRATION_MTIME" ]; then
    echo "⚠️  Schema file is newer than the latest migration!"
    echo "   Schema modified: $(date -d @$SCHEMA_MTIME '+%Y-%m-%d %H:%M:%S')"
    echo "   Latest migration: $(date -d @$MIGRATION_MTIME '+%Y-%m-%d %H:%M:%S') ($LATEST_MIGRATION)"
    echo ""
    echo "💡 This may indicate schema changes that haven't been captured in migrations."
    echo "   Run 'npx drizzle-kit generate' to create a new migration."
    echo ""
  fi
fi

# Step 4: Verify drizzle.config.ts exists
if [ ! -f "drizzle.config.ts" ]; then
  echo "❌ drizzle.config.ts not found!"
  exit 1
fi

echo "✅ Schema sync check complete."

# In CI mode, fail if there are critical issues
if [ "${CI:-false}" = "true" ]; then
  # For now, only warn about missing migrations (don't block CI)
  # Once all tables have migrations, change this to exit 1
  echo ""
  echo "📋 CI Mode: Schema sync check passed (warnings only)."
  echo "   Future: Enable strict mode to block PRs without migrations."
fi
