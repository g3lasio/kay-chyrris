#!/usr/bin/env node

/**
 * Database Setup Script
 * Verifies connection and creates tables if they don't exist
 */

import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is not set');
  process.exit(1);
}

console.log('🗄️  Database Setup Script');
console.log('========================\n');

async function setupDatabase() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
    max: 1,
    connectionTimeoutMillis: 10000,
  });

  try {
    console.log('🔌 Connecting to database...');
    const client = await pool.connect();
    console.log('✅ Connected successfully\n');

    // Test query
    const result = await client.query('SELECT NOW()');
    console.log(`🕐 Database time: ${result.rows[0].now}\n`);

    // Read and execute migration SQL
    console.log('📝 Reading migration SQL...');
    const sqlPath = join(__dirname, '..', 'drizzle', '0000_furry_revanche.sql');
    const sql = readFileSync(sqlPath, 'utf-8');

    console.log('🚀 Executing migrations...\n');
    await client.query(sql);

    console.log('✅ Database setup completed successfully!\n');
    console.log('Tables created:');
    console.log('  - admin_users');
    console.log('  - otp_codes');
    console.log('  - admin_sessions');
    console.log('  - applications');
    console.log('  - subscriptions');
    console.log('  - usage_logs');
    console.log('  - payments');
    console.log('  - announcements');
    console.log('  - announcement_reads');
    console.log('  - push_subscriptions');
    console.log('  - push_notifications');
    console.log('  - notification_campaigns');
    console.log('  - notification_campaign_sends');
    console.log('  - notification_campaign_clicks\n');

    client.release();
    await pool.end();
  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    console.error('\nFull error:', error);
    await pool.end();
    process.exit(1);
  }
}

setupDatabase();
