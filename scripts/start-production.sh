#!/bin/bash
set -e

echo "🚀 Starting Chyrris KAI in production mode"
echo "==========================================="
echo ""

# Check if dist/index.js exists
if [ ! -f "dist/index.js" ]; then
  echo "⚠️  dist/index.js not found, building now..."
  echo ""
  
  # Install dependencies if needed
  if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    pnpm install --frozen-lockfile
    echo ""
  fi
  
  # Build the application
  echo "🔨 Building application..."
  pnpm run build
  echo ""
  
  # Verify build succeeded
  if [ ! -f "dist/index.js" ]; then
    echo "❌ Build failed: dist/index.js was not created"
    exit 1
  fi
  
  echo "✅ Build completed successfully"
  echo ""
fi

# Start the application
echo "🎯 Starting server..."
echo ""
NODE_ENV=production node dist/index.js
