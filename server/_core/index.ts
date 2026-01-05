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


async function startServer() {
  const app = express();
  const server = createServer(app);
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

  // For Autoscale deployments, use PORT env var directly (Cloud Run sets this)
  // In development, default to 5000
  const port = parseInt(process.env.PORT || "5000");

  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${port}/`);
  });
}

startServer().catch(console.error);
