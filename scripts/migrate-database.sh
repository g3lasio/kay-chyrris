#!/bin/bash
set -e

echo "🗄️  Database Migration Script"
echo "=============================="
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL environment variable is not set"
  exit 1
fi

echo "✅ DATABASE_URL is configured"
echo ""

# Run migration script with Node.js
node scripts/migrate.js
