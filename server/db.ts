import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { InsertAdminUser, adminUsers } from "../drizzle/schema";
import { ENV } from './_core/env';

import { Pool } from "pg";

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: Pool | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
// Uses AUTH_DATABASE_URL for authentication tables (OTP, sessions, admin users)
export async function getDb() {
  if (!_db && process.env.AUTH_DATABASE_URL) {
    try {
      // Neon requires SSL. We need to configure it properly.
      // If DATABASE_URL already includes sslmode=require, pg will handle it.
      // Otherwise, we explicitly set SSL options.
      const connectionString = process.env.AUTH_DATABASE_URL;
      
      // Check if URL already has SSL mode configured
      const hasSSLMode = connectionString.includes('sslmode=');
      
      const poolConfig: any = {
        connectionString,
        max: 10, // Maximum number of clients in the pool
        idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
        connectionTimeoutMillis: 10000, // Return an error after 10 seconds if connection could not be established
      };

      // Only set SSL config if not already in connection string
      if (!hasSSLMode) {
        poolConfig.ssl = {
          rejectUnauthorized: false,
        };
      }

      _pool = new Pool(poolConfig);
      
      // Test the connection
      const client = await _pool.connect();
      await client.query('SELECT NOW()');
      client.release();
      
      _db = drizzle(_pool);
      console.log("[Database] Connected successfully to PostgreSQL");
    } catch (error) {
      console.error("[Database] Failed to connect:", error);
      console.error("[Database] AUTH_DATABASE_URL format:", process.env.AUTH_DATABASE_URL?.substring(0, 30) + '...');
      _db = null;
      _pool = null;
    }
  }
  return _db;
}

export async function upsertAdminUser(user: InsertAdminUser): Promise<void> {
  if (!user.email) {
    throw new Error("User email is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertAdminUser = {
      email: user.email,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastLoginAt !== undefined) {
      values.lastLoginAt = user.lastLoginAt;
      updateSet.lastLoginAt = user.lastLoginAt;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    }

    if (!values.lastLoginAt) {
      values.lastLoginAt = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastLoginAt = new Date();
    }

    await db.insert(adminUsers).values(values).onConflictDoUpdate({
      target: adminUsers.email,
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getAdminUserByEmail(email: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Legacy function for auth compatibility
export async function getUserByOpenId(openId: string) {
  // In Chyrris KAI, we use email as the primary identifier
  // This function is kept for compatibility with the auth system
  return undefined;
}

// Legacy function for auth compatibility
export async function upsertUser(user: any) {
  // Convert to admin user format if needed
  if (user.email) {
    return upsertAdminUser({
      email: user.email,
      name: user.name,
      role: user.role || 'admin',
      lastLoginAt: user.lastSignedIn || new Date(),
    });
  }
}
