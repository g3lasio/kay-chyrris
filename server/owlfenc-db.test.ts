/**
 * Test for Owl Fenc Database Connection
 * Validates that OWLFENC_DATABASE_URL and LEADPRIME_DATABASE_URL are configured correctly
 */

import { describe, it, expect } from 'vitest';
import { getOwlFencDb, getOwlFencUserCount, getOwlFencDashboardStats } from './services/owlfenc-db';

describe('Owl Fenc Database Connection', () => {
  it('should have OWLFENC_DATABASE_URL configured', () => {
    expect(process.env.OWLFENC_DATABASE_URL).toBeDefined();
    expect(process.env.OWLFENC_DATABASE_URL).toContain('postgresql://');
  });

  it('should connect to Owl Fenc database', () => {
    const db = getOwlFencDb();
    expect(db).not.toBeNull();
  });

  it('should fetch user count from Owl Fenc database', async () => {
    const count = await getOwlFencUserCount();
    expect(count).toBeGreaterThan(0);
    console.log(`✅ Found ${count} users in Owl Fenc database`);
  }, 10000);

  it('should fetch dashboard stats from Owl Fenc database', async () => {
    const stats = await getOwlFencDashboardStats();
    
    expect(stats).toBeDefined();
    expect(stats.totalUsers).toBeGreaterThan(0);
    expect(stats.activeSubscriptions).toBeGreaterThanOrEqual(0);
    expect(stats.usersByPlan).toBeDefined();
    
    console.log('✅ Dashboard stats:', JSON.stringify(stats, null, 2));
  }, 10000);
});
