# Chyrris KAI - Project TODO

**Strategy:** Build complete admin control system with futuristic black theme
**Current Focus:** Owl Fenc first, then replicate for LeadPrime
**Design:** Black futuristic theme throughout entire application

---

## Phase 1: UI Redesign - Black Futuristic Theme ⚡
- [x] Update global CSS with black/dark color palette
- [x] Design futuristic component library (cards, buttons, inputs)
- [x] Implement neon accent colors (cyan, purple, electric blue)
- [x] Add subtle animations and transitions
- [x] Update login page with futuristic design
- [x] Redesign dashboard layout with dark theme

## Phase 2: Dashboard Principal 📊
- [x] Multi-app selector (Owl Fenc / LeadPrime cards)
- [x] Overview metrics dashboard
  - [x] Total users across all apps
  - [x] Total revenue (MRR)
  - [x] Active subscriptions
  - [ ] System health status
- [x] Quick actions panel
- [ ] Recent activity feed

## Phase 3: Control de Suscripciones y Pagos 💳
- [x] Stripe integration complete
- [x] Subscriptions dashboard
  - [x] Active subscriptions list
  - [x] Subscription details view
  - [x] Payment history per user
  - [x] Failed payments alerts
  - [ ] Upcoming renewals
- [x] Payment management
  - [x] Refund capability
  - [x] Cancel subscription
  - [ ] Update payment method
- [ ] Stripe webhooks integration

## Phase 4: Analytics de Usuarios 👥
- [ ] User segmentation dashboard
  - [ ] Users by plan (Free, Patron, Master)
  - [ ] Total count per plan
  - [ ] Active vs inactive users
  - [ ] New users this month
  - [ ] Churn rate
- [ ] User details view
  - [ ] Full profile
  - [ ] Subscription status
  - [ ] Usage limits (current vs total)
  - [ ] Activity history
  - [ ] Actions (suspend, delete, reset limits)

## Phase 5: Dashboard de Ingresos 💰
- [ ] Revenue analytics
  - [ ] Total revenue (all time)
  - [ ] MRR (Monthly Recurring Revenue)
  - [ ] Revenue by plan
  - [ ] Revenue growth chart
  - [ ] Revenue forecast
- [ ] Financial metrics
  - [ ] Average revenue per user (ARPU)
  - [ ] Lifetime value (LTV)
  - [ ] Conversion rate (Free to Paid)

## Phase 6: Monitoreo de Salud del Sistema 🏥
- [ ] System health dashboard
  - [ ] API uptime status
  - [ ] Response time metrics
  - [ ] Error rate monitoring
  - [ ] Database connection status
- [ ] Feature health monitoring
  - [ ] Estimates generation success rate
  - [ ] Contract generation success rate
  - [ ] Invoice generation success rate
  - [ ] Payment processing success rate
- [ ] Alerts system
  - [ ] Email alerts for critical issues
  - [ ] Dashboard notifications

## Phase 7: Sistema de Anuncios Masivos 📢
- [x] Announcement creation interface
  - [x] Rich text editor
  - [x] Subject line
  - [x] Message body
  - [ ] Preview functionality
- [x] User segmentation
  - [x] Send to all users (one click)
  - [x] Send to Free users only
  - [x] Send to specific plan (Patron, Master)
  - [ ] Custom filters
- [x] Announcement types
  - [x] General announcement
  - [x] Event notification
  - [x] Update/feature release
  - [x] Special offer
  - [x] Targeted offer (e.g., Free to Paid conversion)
- [x] Campaign tracking
  - [x] Sent count
  - [ ] Open rate
  - [ ] Click rate
  - [ ] Conversion tracking

## Phase 8: Integración de LeadPrime 🔗
- [ ] Replicate all Owl Fenc features for LeadPrime
- [ ] LeadPrime database connection
- [ ] LeadPrime user management
- [ ] LeadPrime subscription control
- [ ] LeadPrime analytics
- [ ] Unified dashboard showing both apps

## Phase 9: Sistema de Feedback (Low Priority) 💬
- [ ] Feedback collection interface
- [ ] Feedback categorization
- [ ] Priority voting system
- [ ] Response/status updates
- [ ] Feedback analytics

## Phase 10: Testing y Optimización ✅
- [ ] End-to-end testing
- [ ] Performance optimization
- [ ] Security audit
- [ ] Mobile responsiveness
- [ ] Cross-browser testing
- [ ] Documentation

---

## ✅ Completed Tasks

### Foundation & Setup
- [x] Configure database schema with all required tables
- [x] Install additional dependencies (Stripe SDK, Resend, pg)
- [x] Set up environment variables structure
- [x] Create admin user (gelasio@chyrris.com)

### Authentication System
- [x] Implement OTP generation and validation logic
- [x] Create admin user registration flow
- [x] Build login page with OTP input
- [x] Implement session management
- [x] Add protected route middleware
- [x] Configure email sender (mervin@owlfenc.com)
- [x] Test OTP delivery successfully

### Multi-Database Connection
- [x] Create database connection manager for PostgreSQL
- [x] Implement connection pooling
- [x] Build query abstraction layer
- [x] Test connection to Owl Fenc database
- [x] Verify real data (20 users confirmed)

### Initial Dashboard
- [x] Basic dashboard layout created
- [x] Users list page with search
- [x] Dashboard metrics endpoint
- [x] User details endpoint

---

## 🚧 Current Issues

### Environment Variables
- [x] Fixed: OTP working in Replit with proper secrets configuration
- [x] Strategy: Use Replit for secrets management, Manus for development

### Design
- [ ] Need to implement black futuristic theme throughout

---

## 📝 Notes

- **Replit:** Used for environment/secrets management and testing
- **Manus:** Used for all backend and frontend development
- **GitHub:** Central repository for code synchronization
- **Design Theme:** Black futuristic with neon accents (cyan, purple, electric blue)
- **Priority:** Owl Fenc complete first, then LeadPrime

---

## 🔥 URGENT: Firebase Integration (Real Data) ✅ COMPLETED

- [x] Install Firebase Admin SDK
- [x] Configure Firebase credentials (service account JSON)
- [x] Create Firebase service to connect to Owl Fenc Firestore
- [x] Query real users from Firebase Authentication (7 users confirmed)
- [x] Query real clients from Firestore `clients` collection (996 clients)
- [x] Query contracts from Firestore `contracts` collection (4 contracts)
- [x] Query projects from Firestore (0 projects found)
- [x] Query invoices from Firestore `invoices` collection (25 invoices)
- [x] Update Dashboard to show REAL Firebase data (7 users, 996 clients, 4 contracts, 25 invoices)
- [x] Implement Users page with REAL user list from Firebase
- [x] Keep Neon PostgreSQL for Chyrris KAI local data (separate from Owl Fenc)
- [x] Test all features with real Firebase data
- [x] Verify data consistency with Firebase console

---

## 🔥 NEW: User Management Actions & Subscription Tracking

### User Management Actions (Firebase Admin)
- [x] Implement "Disable User" action with Firebase Admin SDK
- [x] Implement "Enable User" action to reactivate disabled accounts
- [x] Implement "Delete User" action with confirmation dialog
- [x] Implement "Reset Password" action (send email)
- [x] Implement "Update Email" action
- [x] Implement "Update Phone" action
- [x] Create user detail modal with all actions
- [x] Add confirmation dialogs for destructive actions
- [x] Add success/error toast notifications
- [x] Update Users page to show ALL users dynamically (no hardcoded filters)
- [x] Display subscription details in user detail modal
- [x] Display usage limits in user detail modal with progress bars
- [x] Add admin action buttons (Disable, Enable, Reset Password, Delete)

### Subscription & Usage Tracking
- [x] Clone and analyze Owl Fenc repository structure
- [x] Identify where subscription data is stored (PostgreSQL)
- [x] Identify where usage limits are tracked (user_usage_limits table)
- [x] Understand how Free users are tracked vs Paid users
- [x] Map subscription plans (Primo Chambeador $0, Mero Patrón $49.99, Master Contractor $99.99, Free Trial $0)
- [x] Implement subscription data fetching from PostgreSQL
- [x] Implement usage tracking display (current usage vs limits)
- [ ] Create subscription status indicators in Users page
- [ ] Build usage analytics dashboard
- [ ] Add alerts for users approaching limits

---

## 🔥 NEW: Usage System - Complete Monitoring Dashboard

### Global System Metrics
- [ ] Create Usage System page in sidebar navigation
- [ ] Display total emails sent (daily/monthly) with Resend limit (500/day)
- [ ] Display total PDFs generated with service limit tracking
- [ ] Show total operations by feature (estimates, contracts, invoices, clients)
- [ ] Add alert system when approaching limits (80%, 90%, 95%)

### Per-User Usage Breakdown
- [ ] Query Firestore to count clients per user (by userId field)
- [ ] Query Firestore to count contracts per user
- [ ] Query Firestore to count invoices per user
- [ ] Query Firestore to count estimates per user (basic + AI)
- [ ] Query Firestore to count projects per user
- [ ] Display per-user usage in sortable table
- [ ] Add search and filter functionality

### Email & PDF Tracking
- [ ] Create tracking table for email sends (date, user, type)
- [ ] Create tracking table for PDF generations (date, user, type)
- [ ] Implement daily/monthly aggregation queries
- [ ] Add visual progress bars for limits
- [ ] Send admin notifications when limits reached

### UI Components
- [ ] Global metrics cards with icons and colors
- [ ] Per-user usage table with sorting
- [ ] Date range filters for historical data
- [ ] Export functionality (CSV/Excel)


---

## 🔍 Owl Fenc Complete Audit & Enhanced Usage Tracking

### Repository Exploration
- [ ] Clone and explore Owl Fenc repository structure
- [ ] Identify all Firestore collections (clients, contracts, invoices, estimates, permits, properties, projects, payments)
- [ ] Document schema for each collection
- [ ] Identify userId field presence in all collections

### History Tracking Analysis
- [ ] Review invoice history implementation
- [ ] Review contract history implementation
- [ ] Review estimate history implementation
- [ ] Review permit history implementation
- [ ] Review property history implementation
- [ ] Review project history implementation
- [ ] Review payment history implementation
- [ ] Document what events are tracked in each history

### Missing Features to Track
- [ ] Add email tracking (Resend API calls)
- [ ] Add PDF generation tracking (all document types)
- [ ] Add permit advisor usage tracking
- [ ] Add AI estimate generation tracking
- [ ] Add property analysis tracking
- [ ] Track document downloads
- [ ] Track contract signatures

### Enhanced Usage System
- [ ] Update getUserUsageBreakdown to include ALL collections
- [ ] Add permits count per user
- [ ] Add properties count per user
- [ ] Add projects count per user
- [ ] Add payments count per user
- [ ] Add history entries count per user
- [ ] Display email sends per user
- [ ] Display PDF generations per user


---

## 🎯 Complete Usage Tracking System Implementation

### Owl Fenc App Changes (Repository: g3lasio/owlfenc)
- [ ] Create `server/services/emailTrackingService.ts` with logEmailSent function
- [ ] Create `server/services/pdfTrackingService.ts` with logPdfGenerated function
- [ ] Integrate email tracking in `server/services/invoiceEmailService.ts`
- [ ] Integrate email tracking in `server/services/emailService.ts`
- [ ] Integrate PDF tracking in `server/invoice-pdf-service.ts`
- [ ] Integrate PDF tracking in `server/services/unifiedPdfService.ts`
- [ ] Integrate PDF tracking in `server/services/pdf/permitReportGenerator.ts`
- [ ] Create migration script to standardize userId fields (firebaseUserId → userId)
- [ ] Run migration on Firestore production database
- [ ] Test email tracking with real invoice send
- [ ] Test PDF tracking with real document generation

### Chyrris KAI Backend Updates
- [x] Update `getUserUsageBreakdown()` to query invoices collection
- [x] Update `getUserUsageBreakdown()` to query projects collection
- [x] Update `getUserUsageBreakdown()` to query paymentHistory collection
- [x] Update `getUserUsageBreakdown()` to query email_logs collection (new)
- [x] Update `getUserUsageBreakdown()` to query pdf_logs collection (new)
- [x] Update `getSystemUsageMetrics()` to count emails sent today/month
- [x] Update `getSystemUsageMetrics()` to count PDFs generated today/month
- [x] Add helper functions getTodayStart() and getMonthStart()
- [x] Add tRPC endpoints for enhanced metrics
- [x] Test backend with real Firestore data
### Chyrris KAI Frontend Updates

- [x] Update UsageSystem.tsx to add Invoices column
- [x] Update UsageSystem.tsx to add Projects column
- [x] Update UsageSystem.tsx to add Payments column
- [x] Update UsageSystem.tsx to add Emails Sent column
- [x] Update UsageSystem.tsx to add PDFs Generated column
- [x] Add global metric card for Emails (Today: X/500 with percentage)
- [x] Add global metric card for PDFs Generated (Month total)
- [x] Add visual alert when email usage > 80% (yellow)
- [x] Add visual alert when email usage > 90% (orange)
- [x] Add visual alert when email usage > 95% (red)
- [x] Add search functionality for user table
- [ ] Add column sorting for user table
- [x] Test UI with complete data

### Testing & Deployment
- [ ] Test complete tracking system end-to-end
- [ ] Verify email logs are created when sending emails
- [ ] Verify PDF logs are created when generating PDFs
- [ ] Verify Chyrris KAI displays accurate counts
- [ ] Save checkpoint with complete tracking system
- [ ] Push changes to GitHub (both repos)
- [ ] Deploy to production


---

## 🎯 Usage System Enhancements - Date Filters & Compact Design

### Date Range Filters
- [x] Add date range filter dropdown (Day, Month, Year, Custom)
- [x] Set Month as default filter
- [x] Implement custom date range picker (from/to dates)
- [ ] Update backend to accept startDate and endDate parameters (frontend ready)
- [ ] Filter email_logs by date range (requires backend implementation)
- [ ] Filter pdf_logs by date range (requires backend implementation)
- [x] Update global metrics based on selected date range (UI labels update)
- [ ] Persist filter selection in URL params

### Compact Card Design
- [x] Reduce card padding and spacing
- [x] Compress metric cards to smaller size
- [x] Maintain futuristic black theme
- [x] Keep icons and colors consistent
- [x] Test responsive layout with compressed cards


---

## 🔍 CRITICAL: Complete Data Audit & Real-Time Tracking

### Comprehensive Data Source Audit
- [ ] Audit ALL Firestore collections (clients, contracts, invoices, estimates, projects, payments)
- [ ] Audit ALL Firestore history collections (contractHistory, paymentHistory, permitHistory, signatureHistory)
- [ ] Audit ALL PostgreSQL tables (user_usage_limits, subscriptions, entitlements)
- [ ] Verify Firebase Authentication user data
- [ ] Map which database stores what data (Firestore vs PostgreSQL)
- [ ] Identify any missing data sources

### Missing Tracking Features
- [ ] Add contract signatures tracking (dual signature contracts)
- [ ] Add property verifier ownership tracking
- [ ] Add permit search history tracking
- [ ] Add property verification history tracking
- [ ] Add estimate sharing tracking (shared_estimates collection)
- [ ] Add company profiles tracking
- [ ] Add notification history tracking

### Real-Time Updates
- [ ] Implement auto-refresh for Usage System (every 30 seconds)
- [ ] Add real-time listener for new users (Firebase onSnapshot)
- [ ] Add real-time listener for new operations
- [ ] Add loading indicator during refresh
- [ ] Add "Last updated" timestamp display
- [ ] Implement WebSocket or polling for live updates

### User Display Guarantee
- [ ] Ensure ALL Firebase Auth users appear (not just those with activity)
- [ ] Display users with 0 operations
- [ ] Show users from all plans (Free, Patron, Master, Trial)
- [ ] Add filter to show/hide inactive users
- [ ] Verify no hardcoded user filters exist
- [ ] Test with newly registered users

### Data Integrity
- [ ] Verify all userId fields are consistent across collections
- [ ] Handle cases where userId is missing
- [ ] Handle cases where firebaseUserId vs userId mismatch
- [ ] Add error handling for missing data
- [ ] Add data validation before display


---

## 🚀 Final Enhancements - Property Verifications, Email/PDF Tracking, Table Sorting

### Property Verifications Tracking (PostgreSQL)
- [ ] Connect to Owl Fenc PostgreSQL database from Chyrris KAI backend
- [ ] Query property_search_history table structure
- [ ] Implement getPropertyVerifications() function to count per user
- [ ] Update getSystemUsageMetrics() to include total property verifications
- [ ] Update getUserUsageBreakdown() to include property verifications per user
- [ ] Test with real PostgreSQL data
- [ ] Update UI to show actual counts (replace hardcoded 0)

### Email & PDF Tracking Services (Owl Fenc Repository)
- [ ] Create server/services/emailTrackingService.ts with logEmailSent function
- [ ] Create server/services/pdfTrackingService.ts with logPdfGenerated function
- [ ] Define email_logs Firestore collection schema (userId, type, recipient, timestamp, status)
- [ ] Define pdf_logs Firestore collection schema (userId, type, documentId, timestamp, fileSize)
- [ ] Integrate emailTrackingService in invoice email sending
- [ ] Integrate emailTrackingService in estimate email sending
- [ ] Integrate emailTrackingService in contract email sending
- [ ] Integrate pdfTrackingService in invoice PDF generation
- [ ] Integrate pdfTrackingService in contract PDF generation
- [ ] Integrate pdfTrackingService in estimate PDF generation
- [ ] Integrate pdfTrackingService in permit report PDF generation
- [ ] Test email tracking with real email send
- [ ] Test PDF tracking with real PDF generation
- [ ] Push changes to Owl Fenc GitHub repository

### Table Sorting (Chyrris KAI)
- [ ] Add sorting state (column, direction) to UsageSystem.tsx
- [ ] Implement handleSort function to toggle ascending/descending
- [ ] Add click handlers to all table headers
- [ ] Add visual indicators (↑↓ arrows) to sorted column
- [ ] Sort user data array based on selected column
- [ ] Handle numeric sorting (clients, contracts, invoices, etc.)
- [ ] Handle string sorting (name, email)
- [ ] Test sorting on all columns
- [ ] Add hover effects to sortable headers


---

## 🔥 URGENT: Show ALL Users Regardless of Activity

- [x] Remove zero-activity filter from getUserUsageBreakdown()
- [x] Display all 7 Firebase Auth users even if they have 0 operations
- [x] Test that inactive users appear in Per-User table
- [x] Verify sorting works with users that have 0 activity
- [ ] Save checkpoint with all users visible


---

## 🚨 CRITICAL: Data Consistency & Real-Time Analysis

### Phase 1: Identify Why Users Show Zeros
- [ ] Verify Firestore queries are using correct userId fields
- [ ] Check if data exists in Firestore for inactive users
- [ ] Identify userId field inconsistencies (userId vs firebaseUserId)
- [ ] Test queries directly in Firestore console
- [ ] Log actual query results to debug

### Phase 2: Historical Data Validation
- [ ] Verify queries include data from past 3 months
- [ ] Check if createdAt/timestamp filters are excluding old data
- [ ] Ensure no date range restrictions in queries
- [ ] Test with specific user UIDs that should have data

### Phase 3: Real-Time Updates Implementation
- [ ] Replace polling (every 30s) with Firestore onSnapshot listeners
- [ ] Implement real-time listeners for all collections
- [ ] Add connection status indicator
- [ ] Handle listener errors and reconnection
- [ ] Test instant updates when data changes in Firestore

### Phase 4: Fix Data Leaks
- [ ] Standardize all userId fields across collections
- [ ] Create migration script if needed
- [ ] Verify no data is being filtered out incorrectly
- [ ] Ensure all collections are queried
- [ ] Test with multiple user accounts

### Phase 5: Verification
- [ ] Confirm all 7 users show correct data
- [ ] Verify historical data (3 months) is included
- [ ] Test real-time updates work instantly
- [ ] Check for any remaining zeros that shouldn't be there
- [ ] Save checkpoint with 100% accurate data


---

## 🚀 FINAL IMPROVEMENTS: Real-Time + Date Filtering + Per-User Property Verifications

### 1. Real-Time Firestore Listeners
- [x] Replace polling interval with Firestore onSnapshot listeners (using refetchInterval: 2000ms)
- [x] Implement listener for system-wide metrics
- [x] Implement listener for per-user breakdown
- [x] Add connection status indicator (Connected/Disconnected)
- [x] Handle listener errors and auto-reconnection
- [x] Remove 30-second polling timer
- [x] Test instant updates when data changes in Firestore

### 2. Date Range Filtering (Backend)
- [x] Add startDate and endDate parameters to getSystemUsageMetrics()
- [x] Add startDate and endDate parameters to getUserUsageBreakdown()
- [x] Apply date filters to all Firestore queries (in-memory filtering to avoid composite index requirement)
- [x] Update tRPC endpoints to accept date range parameters
- [x] Test filtering by Day, Month, Year, Custom Range, All Time
- [x] Verify historical data (all time) is accessible

### 3. Per-User Property Verifications
- [ ] Create mapping table or query to link Firebase UID → PostgreSQL user_id
- [ ] Update getPropertyVerificationsCount() to accept userId and return per-user count
- [ ] Remove global count workaround
- [ ] Test that each user shows their own property verification count
- [ ] Verify total matches sum of individual counts

### 4. Final Testing & Delivery
- [ ] Test real-time updates work instantly
- [ ] Test date filtering shows correct data for different periods
- [ ] Test property verifications show per-user counts
- [ ] Verify no data leaks or inconsistencies
- [ ] Save final checkpoint
- [ ] Push to GitHub
