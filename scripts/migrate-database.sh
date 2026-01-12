#!/bin/bash
set -e

echo "🗄️  Database Migration Script"
echo "=============================="

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL environment variable is not set"
  exit 1
fi

echo "✅ DATABASE_URL is configured"
echo ""

# Generate migrations
echo "📝 Generating migrations from schema..."
pnpm drizzle-kit generate

echo ""
echo "🚀 Applying migrations to database..."
pnpm drizzle-kit migrate

echo ""
echo "✅ Database migration completed successfully!"
