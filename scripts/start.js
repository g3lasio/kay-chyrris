#!/usr/bin/env node

/**
 * Production Start Script with Auto-Build
 * This script ensures the application is built before starting
 */

import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const ROOT_DIR = process.cwd();
const DIST_FILE = join(ROOT_DIR, 'dist', 'index.js');

console.log('🚀 Starting Chyrris KAI in production mode');
console.log('===========================================\n');

// Check if dist/index.js exists
if (!existsSync(DIST_FILE)) {
  console.log('⚠️  dist/index.js not found, building now...\n');
  
  try {
    // Check if node_modules exists
    if (!existsSync(join(ROOT_DIR, 'node_modules'))) {
      console.log('📦 Installing dependencies...');
      execSync('pnpm install --frozen-lockfile', { 
        stdio: 'inherit',
        cwd: ROOT_DIR 
      });
      console.log('');
    }
    
    // Build the application
    console.log('🔨 Building application...');
    execSync('pnpm run build', { 
      stdio: 'inherit',
      cwd: ROOT_DIR 
    });
    console.log('');
    
    // Verify build succeeded
    if (!existsSync(DIST_FILE)) {
      console.error('❌ Build failed: dist/index.js was not created');
      process.exit(1);
    }
    
    console.log('✅ Build completed successfully\n');
  } catch (error) {
    console.error('❌ Build process failed:', error.message);
    process.exit(1);
  }
}

// Start the application
console.log('🎯 Starting server...\n');
process.env.NODE_ENV = 'production';

// Import and run the server
import(DIST_FILE).catch((error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
