# Chyrris KAI - Deployment Guide

## Overview

Chyrris KAI is a **portable web application** that works in any Node.js environment (Replit, Vercel, Railway, etc.). It has **NO dependencies on Manus services** and requires **NO authentication**.

## Features

- ✅ Dashboard with real-time metrics from Owl Fenc database
- ✅ User management (21 users, 12 active subscriptions)
- ✅ Payment tracking with Stripe integration
- ✅ Mass announcements system
- ✅ No authentication required (public access)
- ✅ Works in any environment

## Environment Variables

Configure these in your hosting platform's Secrets/Environment panel:

### Required for Database Access
```
OWLFENC_DATABASE_URL=postgresql://...
LEADPRIME_DATABASE_URL=postgresql://...
```

### Required for Stripe Integration
```
STRIPE_SECRET_KEY=sk_live_...
```

### Required for Email Notifications
```
RESEND_API_KEY=re_...
```

### Optional (for specific features)
```
DATABASE_URL=mysql://...  # If using local database
JWT_SECRET=your-secret-here  # If enabling authentication later
```

## Deployment Instructions

### Replit

1. **Clone the repository**:
   ```bash
   git clone https://github.com/g3lasio/kay-chyrris.git
   cd kay-chyrris
   ```

2. **Configure Secrets**:
   - Click on 🔒 **Secrets** in the left sidebar
   - Add all required environment variables listed above

3. **Install dependencies**:
   ```bash
   pnpm install
   ```

4. **Run the application**:
   ```bash
   pnpm dev
   ```

5. **Access the dashboard**:
   - Open the Webview in Replit
   - Navigate to `/` to see the dashboard

### Vercel

1. **Import the repository** from GitHub
2. **Configure Environment Variables** in Project Settings
3. **Deploy** - Vercel will automatically detect the configuration

### Railway

1. **New Project** → Deploy from GitHub
2. **Add Environment Variables** in the Variables tab
3. **Deploy** - Railway will handle the rest

## Port Configuration

The application uses **port 3000** by default. If your environment requires a different port:

1. Set the `PORT` environment variable
2. The app will automatically use it

## Database Setup

The application connects to external PostgreSQL databases (Neon):

- **Owl Fenc Database**: User data, subscriptions, projects
- **LeadPrime Database**: Additional data source

No local database setup required - just configure the connection strings.

## Troubleshooting

### "portal.manus.im's server IP address could not be found"

This error means you're using an old version with Manus dependencies. Pull the latest code:

```bash
git fetch origin
git reset --hard origin/main
```

### "Authentication failed" errors

Authentication is completely disabled. If you see these errors, check that you have the latest code.

### Port conflicts

If port 3000 is in use, the app will automatically try ports 3001-3019. Or set the `PORT` environment variable.

### Missing environment variables

Check the console output for warnings about missing variables. Add them to your Secrets/Environment panel.

## Architecture

- **Frontend**: React 19 + Tailwind CSS 4 + Wouter (routing)
- **Backend**: Express 4 + tRPC 11 + Drizzle ORM
- **Database**: PostgreSQL (Neon)
- **Payments**: Stripe
- **Email**: Resend

## Development

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev

# Run tests
pnpm test

# Build for production
pnpm build
```

## Support

For issues or questions, check the GitHub repository: https://github.com/g3lasio/kay-chyrris
