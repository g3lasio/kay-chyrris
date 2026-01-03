# 🔍 Complete Data Audit - Owl Fenc App

**Date:** January 3, 2026  
**Purpose:** Identify ALL data sources (Firestore, PostgreSQL) to ensure complete tracking coverage in Chyrris KAI

---

## 📊 Data Sources Overview

### **1. Firebase Authentication**
- **Purpose:** User authentication and basic profile data
- **Fields:** uid, email, displayName, phoneNumber, disabled, metadata (creationTime, lastSignInTime)
- **Current Status:** ✅ Being queried in Chyrris KAI

### **2. Firestore Collections** (35 total)

#### **Core Business Operations** (9 collections)
| Collection | Purpose | userId Field | Tracked in Chyrris KAI |
|------------|---------|--------------|------------------------|
| `clients` | Client database | `userId` | ✅ YES |
| `contracts` | Generated contracts | `userId` | ✅ YES |
| `contractHistory` | Contract modification history | `userId` | ❌ NO |
| `dualSignatureContracts` | Contracts requiring dual signatures | `userId` | ❌ NO |
| `estimates` | Estimates (basic + AI) | `firebaseUserId` | ✅ YES |
| `shared_estimates` | Shared estimate links | `userId` | ❌ NO |
| `projects` | Project management | `userId` | ✅ YES |
| `invoices` | Generated invoices | `userId` | ✅ YES |
| `companyProfiles` | Company profile data | `userId` | ❌ NO |

#### **History & Tracking** (3 collections)
| Collection | Purpose | userId Field | Tracked in Chyrris KAI |
|------------|---------|--------------|------------------------|
| `permit_search_history` | Permit advisor searches | `userId` | ❌ NO |
| `property_search_history` (PostgreSQL) | Property verifier searches | `user_id` | ❌ NO |
| `contractHistory` | Contract changes log | `userId` | ❌ NO |

#### **System & Admin** (13 collections)
| Collection | Purpose | Tracked |
|------------|---------|---------|
| `admin_analytics` | Admin dashboard metrics | ❌ NO |
| `admin_notifications` | Admin notifications | ❌ NO |
| `audit_logs` | System audit trail | ❌ NO |
| `security_audit_logs` | Security events | ❌ NO |
| `audit_exports` | Exported audit data | ❌ NO |
| `data_exports` | Data export requests | ❌ NO |
| `export_summaries` | Export summaries | ❌ NO |
| `kpi_reports` | KPI metrics | ❌ NO |
| `webhook_logs` | Webhook events | ❌ NO |
| `rate_limits` | API rate limiting | ❌ NO |
| `abuse_logs` | Abuse detection | ❌ NO |
| `completionJobs` | Background jobs | ❌ NO |
| `system_config` | System configuration | ❌ NO |

#### **User Management** (5 collections)
| Collection | Purpose | Tracked |
|------------|---------|---------|
| `users` | Extended user data | ❌ NO |
| `userProfiles` | User profile details | ❌ NO |
| `user_security` | Security settings | ❌ NO |
| `user_sessions` | Active sessions | ❌ NO |
| `token_revocations` | Revoked tokens | ❌ NO |

#### **Support** (3 collections)
| Collection | Purpose | Tracked |
|------------|---------|---------|
| `notifications` | User notifications | ❌ NO |
| `support_tickets` | Support requests | ❌ NO |
| `support_ticket_responses` | Ticket responses | ❌ NO |

#### **Payment & Subscriptions** (3 collections)
| Collection | Purpose | Tracked |
|------------|---------|---------|
| `stripe_customers` | Stripe customer data | ❌ NO |
| `entitlements` | User entitlements | ❌ NO |
| `usage` | Usage tracking | ❌ NO |

### **3. PostgreSQL Tables** (Neon Database)

#### **Subscription Management**
| Table | Purpose | Tracked in Chyrris KAI |
|-------|---------|------------------------|
| `subscriptions` | Active subscriptions | ✅ YES (via owlfenc-subscriptions.ts) |
| `user_usage_limits` | Usage limits per user | ✅ YES (via owlfenc-subscriptions.ts) |
| `property_search_history` | Property verifier history | ❌ NO |

---

## 🚨 CRITICAL MISSING TRACKING

### **Operations NOT Being Counted:**

1. **Contract Signatures** (`dualSignatureContracts`)
   - Dual signature contracts created
   - Signatures completed
   - Signature requests sent

2. **Permit Searches** (`permit_search_history`)
   - Permit advisor searches performed
   - Permit reports generated
   - Permit analysis requests

3. **Property Verifications** (`property_search_history` in PostgreSQL)
   - Property ownership verifications
   - Property detail lookups
   - Property history searches

4. **Estimate Sharing** (`shared_estimates`)
   - Estimates shared via link
   - Shared estimate views
   - Shared estimate conversions

5. **Contract History** (`contractHistory`)
   - Contract modifications
   - Contract status changes
   - Contract updates

6. **Company Profiles** (`companyProfiles`)
   - Company profiles created
   - Company info updates

7. **Notifications** (`notifications`)
   - Notifications sent to users
   - Notification delivery status

8. **Support Tickets** (`support_tickets`, `support_ticket_responses`)
   - Support requests created
   - Ticket responses
   - Ticket resolution time

---

## 📝 RECOMMENDED ACTIONS

### **Phase 1: Add Missing Collections to Backend**
Update `server/services/owlfenc-firebase.ts` to query:
- `permit_search_history` (Firestore)
- `property_search_history` (PostgreSQL)
- `dualSignatureContracts` (Firestore)
- `shared_estimates` (Firestore)
- `contractHistory` (Firestore)
- `companyProfiles` (Firestore)

### **Phase 2: Update Frontend UI**
Add columns to Usage System:
- Permit Searches
- Property Verifications
- Dual Signature Contracts
- Shared Estimates
- Contract Modifications

### **Phase 3: Create Email & PDF Tracking**
Create new collections:
- `email_logs` (Firestore) - Track all emails sent via Resend
- `pdf_logs` (Firestore) - Track all PDFs generated

### **Phase 4: Implement Real-Time Updates**
- Add auto-refresh every 30 seconds
- Add Firebase onSnapshot listeners for real-time data
- Add "Last updated" timestamp

### **Phase 5: Ensure ALL Users Appear**
- Query Firebase Authentication directly (not just users with activity)
- Show users with 0 operations
- Display users from all plans (Free, Patron, Master, Trial)

---

## 🔧 userId Field Inconsistency

**Problem:** Different collections use different field names for user ID:
- `clients`, `contracts`, `invoices`, `projects`: use `userId`
- `estimates`: uses `firebaseUserId`
- PostgreSQL: uses `user_id`

**Solution:** 
- Handle both `userId` and `firebaseUserId` in queries
- Standardize to `userId` in future (requires migration script)

---

## ✅ Currently Tracked in Chyrris KAI

1. ✅ Clients (`clients` collection)
2. ✅ Contracts (`contracts` collection)
3. ✅ Invoices (`invoices` collection)
4. ✅ Estimates (`estimates` collection)
5. ✅ Projects (`projects` collection)
6. ✅ Payments (from `paymentHistory` - assumed, needs verification)
7. ✅ Subscriptions (PostgreSQL `subscriptions` table)
8. ✅ Usage Limits (PostgreSQL `user_usage_limits` table)

---

## ❌ NOT Tracked in Chyrris KAI

1. ❌ Permit Searches
2. ❌ Property Verifications
3. ❌ Dual Signature Contracts
4. ❌ Shared Estimates
5. ❌ Contract History/Modifications
6. ❌ Company Profiles
7. ❌ Notifications Sent
8. ❌ Support Tickets
9. ❌ Emails Sent (no collection exists)
10. ❌ PDFs Generated (no collection exists)

---

## 🎯 Priority Implementation Order

### **HIGH PRIORITY** (User-facing operations)
1. Permit Searches (`permit_search_history`)
2. Property Verifications (`property_search_history`)
3. Dual Signature Contracts (`dualSignatureContracts`)
4. Shared Estimates (`shared_estimates`)
5. Email Tracking (create `email_logs`)
6. PDF Tracking (create `pdf_logs`)

### **MEDIUM PRIORITY** (History & modifications)
7. Contract History (`contractHistory`)
8. Company Profiles (`companyProfiles`)

### **LOW PRIORITY** (System/admin)
9. Notifications (`notifications`)
10. Support Tickets (`support_tickets`)
11. Audit Logs (`audit_logs`)

---

## 🔄 Real-Time Updates Strategy

### **Option 1: Auto-Refresh (Recommended)**
- Refresh data every 30 seconds using `setInterval`
- Show "Last updated: X seconds ago"
- Add manual refresh button

### **Option 2: Firebase onSnapshot**
- Use real-time listeners for Firestore collections
- More complex but truly real-time
- May increase Firebase read costs

### **Option 3: WebSocket/Polling**
- Server-side push notifications
- Most complex implementation
- Best for large-scale deployments

**Recommendation:** Start with Option 1 (auto-refresh), upgrade to Option 2 if needed.

---

## 📊 Expected Final Metrics

After implementing all tracking, each user will show:
- Clients
- Contracts
- Invoices
- Estimates (Basic + AI)
- Projects
- Payments
- **Permit Searches** (NEW)
- **Property Verifications** (NEW)
- **Dual Signature Contracts** (NEW)
- **Shared Estimates** (NEW)
- **Contract Modifications** (NEW)
- **Emails Sent** (NEW)
- **PDFs Generated** (NEW)
- **Total Operations** (sum of all above)

---

## 🚀 Next Steps

1. Review this audit with the team
2. Prioritize which metrics to implement first
3. Update backend queries to include missing collections
4. Update frontend UI to display new metrics
5. Test with real data
6. Deploy and monitor

---

**Status:** 🟡 IN PROGRESS  
**Last Updated:** January 3, 2026  
**Next Review:** After implementation of high-priority items
