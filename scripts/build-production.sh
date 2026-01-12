#!/bin/bash
set -e

echo "🔨 Starting production build..."

# Clean dist directory
echo "🧹 Cleaning dist directory..."
rm -rf dist

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile

# Build frontend with Vite
echo "⚛️  Building frontend with Vite..."
pnpm vite build

# Build backend with esbuild
echo "🔧 Building backend with esbuild..."
pnpm esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist

# Verify build outputs
echo "✅ Verifying build outputs..."

if [ ! -f "dist/index.js" ]; then
  echo "❌ ERROR: dist/index.js was not generated!"
  exit 1
fi

if [ ! -d "dist/public" ]; then
  echo "❌ ERROR: dist/public directory was not generated!"
  exit 1
fi

echo "✅ Build completed successfully!"
echo "📁 Generated files:"
ls -lh dist/
echo ""
echo "📂 Public directory:"
ls -lh dist/public/ | head -10
