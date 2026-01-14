import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { InsertAdminUser, adminUsers } from "../drizzle/schema";
import { ENV } from './_core/env';

import { Pool } from "pg";

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: Pool | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      // Neon requires SSL. We force it to be enabled with rejectUnauthorized: false
      // to avoid SSL handshake errors in both production and development environments.
      const sslConfig = {
        rejectUnauthorized: false,
      };

      _pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: sslConfig,
      });
      
      _db = drizzle(_pool);
      console.log("[Database] Connected successfully with SSL");
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
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
