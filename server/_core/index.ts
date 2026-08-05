import "dotenv/config";
import dotenv from 'dotenv';

// Load .env.local only in local development (not in Replit/production)
if (process.env.NODE_ENV !== 'production' && !process.env.REPL_ID) {
  dotenv.config({ path: '.env.local' });
}

import express from "express";
import { createServer } from "http";
import cookieParser from "cookie-parser";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
// OAuth disabled - no Manus dependencies
// import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

/**
 * Seed the applications table with the Owl Fenc application record.
 * Uses ON CONFLICT DO NOTHING so it is safe to run on every startup.
 * applicationId=1 is the canonical ID used throughout the codebase.
 */
async function seedApplications() {
  try {
    const { getDb } = await import('../db');
    const { applications } = await import('../../drizzle/schema');
    const { sql } = await import('drizzle-orm');

    const db = await getDb();
    if (!db) {
      console.warn('[Seed] Database not available — skipping applications seed');
      return;
    }

    const owlfencDbUrl = process.env.OWLFENC_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://localhost/owlfenc';

    // Insert with explicit id=1 so all FK references work
    await db.execute(sql`
      INSERT INTO applications (id, name, slug, description, database_url, database_type, status, color)
      VALUES (
        1,
        'Owl Fenc',
        'owlfenc',
        'AI-powered estimating, contracts, invoices, and permit advisor for fence contractors',
        ${owlfencDbUrl},
        'postgresql',
        'active',
        '#00bcd4'
      )
      ON CONFLICT (id) DO NOTHING
    `);

    console.log('[Seed] applications table: Owl Fenc record ensured (id=1)');
  } catch (error) {
    // Non-fatal: log and continue — the app should still start
    console.error('[Seed] Failed to seed applications table:', error);
  }
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Trust reverse proxies (Railway/Cloud Run) so req.protocol reflects original HTTPS.
  app.set("trust proxy", 1);
  // Configure cookie parser
  app.use(cookieParser());
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  
  // Health check endpoint for Cloud Run / deployment
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });
  
  // Root health check for Cloud Run (responds immediately without parameters)
  app.get("/", (req, res, next) => {
    // If it's a health check (no accept header for HTML), respond with 200
    const acceptHeader = req.headers.accept || "";
    if (!acceptHeader.includes("text/html")) {
      return res.status(200).json({ status: "ok" });
    }
    // Otherwise, let Vite/static serve handle it
    next();
  });
  
  // OAuth disabled - no Manus dependencies
  // registerOAuthRoutes(app);

  // Public referral-capture endpoints (called by the LeadPrime signup)
  const { registerReferralRoutes } = await import("../partner/referral-routes");
  registerReferralRoutes(app);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Seed required reference data (idempotent — safe on every startup)
  await seedApplications();

  // Vigilancia activa del ecosistema: sondea a cada proveedor y ALERTA por
  // SMS/email cuando algo se degrada, sin depender de que alguien tenga el
  // panel abierto. Nunca bloquea el arranque.
  try {
    const { startHealthMonitor } = await import('../services/health-monitor');
    startHealthMonitor();
  } catch (err: any) {
    console.error('[Server] No se pudo iniciar el monitor de salud:', err.message);
  }

  // Partner portal: ensure referral_* tables exist (idempotent, additive)
  // and start the periodic commission sync (reads LeadPrime, writes Kai).
  const { ensurePartnerTables } = await import("../partner/ensure-tables");
  await ensurePartnerTables();
  const { startCommissionSyncSchedule } = await import("../partner/commission-engine");
  startCommissionSyncSchedule();

  // For Autoscale deployments, use PORT env var directly (Cloud Run sets this)
  // In development, default to 5000
  const port = parseInt(process.env.PORT || "5000");

  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${port}/`);
  });
}

startServer().catch(console.error);
