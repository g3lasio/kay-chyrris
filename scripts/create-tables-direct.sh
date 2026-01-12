#!/bin/bash
set -e

echo "🗄️  Direct SQL Table Creation Script"
echo "====================================="
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL environment variable is not set"
  exit 1
fi

echo "✅ DATABASE_URL is configured"
echo ""

echo "📝 This script will execute the SQL migration file directly"
echo "   using psql command line tool"
echo ""

# Check if psql is available
if ! command -v psql &> /dev/null; then
  echo "❌ ERROR: psql command not found"
  echo "   Installing postgresql-client..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq postgresql-client
fi

echo "🚀 Executing SQL migrations..."
echo ""

# Execute the SQL file
psql "$DATABASE_URL" -f drizzle/0000_furry_revanche.sql

echo ""
echo "✅ Tables created successfully!"
echo ""
echo "Tables created:"
echo "  - admin_users"
echo "  - otp_codes"
echo "  - admin_sessions"
echo "  - applications"
echo "  - notification_campaigns"
echo "  - campaign_recipients"
echo "  - user_feedback"
echo "  - error_logs"
echo "  - health_checks"
echo "  - admin_activity_log"
echo "  - stripe_customers_cache"
echo "  - daily_metrics"
echo "  - in_app_notifications"
echo "  - notification_preferences"
