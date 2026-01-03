import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';

describe('Owl Fenc PostgreSQL Connection', () => {
  it('should connect to Owl Fenc PostgreSQL database', async () => {
    const pool = new Pool({
      connectionString: process.env.OWLFENC_DATABASE_URL,
    });

    try {
      const result = await pool.query('SELECT NOW()');
      expect(result.rows.length).toBeGreaterThan(0);
      console.log('✅ Connected to Owl Fenc PostgreSQL successfully');
    } finally {
      await pool.end();
    }
  });

  it('should fetch users from Owl Fenc database', async () => {
    const pool = new Pool({
      connectionString: process.env.OWLFENC_DATABASE_URL,
    });

    try {
      const result = await pool.query('SELECT COUNT(*) as count FROM users');
      const count = parseInt(result.rows[0].count);
      expect(count).toBeGreaterThan(0);
      console.log(`✅ Found ${count} users in Owl Fenc PostgreSQL`);
    } finally {
      await pool.end();
    }
  });

  it('should fetch subscription plans from Owl Fenc database', async () => {
    const pool = new Pool({
      connectionString: process.env.OWLFENC_DATABASE_URL,
    });

    try {
      const result = await pool.query('SELECT * FROM subscription_plans WHERE is_active = true');
      expect(result.rows.length).toBeGreaterThan(0);
      console.log(`✅ Found ${result.rows.length} active subscription plans`);
      console.log('Plans:', result.rows.map(r => `${r.name} (ID: ${r.id})`).join(', '));
    } finally {
      await pool.end();
    }
  });
});
