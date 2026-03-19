#!/bin/bash
# Pre-commit hook: Warn if schema.ts is modified without a new migration
# Install: ln -sf ../../scripts/pre-commit-schema-check.sh .git/hooks/pre-commit

SCHEMA_CHANGED=$(git diff --cached --name-only | grep "drizzle/schema.ts" || true)
MIGRATION_ADDED=$(git diff --cached --name-only | grep "drizzle/migrations/" || true)

if [ -n "$SCHEMA_CHANGED" ] && [ -z "$MIGRATION_ADDED" ]; then
  echo ""
  echo "⚠️  WARNING: drizzle/schema.ts was modified but no new migration file was added."
  echo ""
  echo "   If you added or modified a table, please run:"
  echo "     npx drizzle-kit generate"
  echo ""
  echo "   If this is intentional (e.g., adding comments), you can skip this check with:"
  echo "     git commit --no-verify"
  echo ""
  # Don't block the commit, just warn
fi
