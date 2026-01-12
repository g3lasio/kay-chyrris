#!/usr/bin/env node

/**
 * Database Migration Script for PostgreSQL (Neon)
 * Handles SSL connections correctly
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const { Pool } = pg;

async function runMigrations() {
  console.log('🗄️  Database Migration Script');
  console.log('==============================\n');

  // Check DATABASE_URL
  if (!process.env.DATABASE_URL) {
    console.error('❌ ERROR: DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  console.log('✅ DATABASE_URL is configured\n');

  // Create connection pool with SSL
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false, // Required for Neon
    },
  });

  console.log('🔌 Connecting to database...');

  try {
    // Test connection
    const client = await pool.connect();
    console.log('✅ Database connection successful\n');
    client.release();

    // Create drizzle instance
    const db = drizzle(pool);

    console.log('🚀 Applying migrations...');
    
    // Run migrations
    await migrate(db, { migrationsFolder: './drizzle' });

    console.log('\n✅ Database migration completed successfully!');
    console.log('\nTables created:');
    console.log('  - admin_users');
    console.log('  - otp_codes');
    console.log('  - admin_sessions');
    console.log('  - applications');
    console.log('  - notification_campaigns');
    console.log('  - campaign_recipients');
    console.log('  - user_feedback');
    console.log('  - error_logs');
    console.log('  - health_checks');
    console.log('  - admin_activity_log');
    console.log('  - stripe_customers_cache');
    console.log('  - daily_metrics');
    console.log('  - in_app_notifications');
    console.log('  - notification_preferences');

  } catch (error) {
    console.error('\n❌ Migration failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migrations
runMigrations();
