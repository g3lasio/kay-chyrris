# Usage System Tracking Analysis

## 🚨 Critical Issues Found

### 1. ❌ Contracts Showing 0

**Problem:** Query was fetching ALL contracts (drafts, progress, completed, cancelled, archived).

**Root Cause:**
```typescript
// OLD (WRONG):
db.collection('contracts').get()

// Brings ALL contracts regardless of status
```

**Solution Applied:** ✅ FIXED
```typescript
// NEW (CORRECT):
db.collection('contracts').where('status', 'in', ['completed', 'both_signed']).get()

// Only counts contracts that reached step 3 (complete) in Legal Defense system
```

**Contract States in Owl Fenc:**
- `draft` - Step 0-1 (incomplete)
- `sent` - Sent but not signed
- `signed` - Partially signed
- `in_progress` - Work in progress
- `completed` - ✅ COMPLETED (counts for Mero Patron 50-contract limit)
- `both_signed` - ✅ DUAL SIGNATURE COMPLETED (also counts)
- `cancelled` - Cancelled (doesn't count)

**Legal Defense System Flow:**
1. Step 0: Select contract type
2. Step 1: Select project / adjustments
3. Step 2: Preview
4. Step 3: **Complete** → PDF only or Dual Signature → **THIS IS WHAT WE COUNT**

---

### 2. ❌ Payments Showing 0

**Problem:** Chyrris KAI is querying `paymentHistory` collection in Firestore, but payments are NOT stored there.

**Current Architecture:**
- **Owl Fenc stores payments in PostgreSQL** inside `projects.paymentDetails.history`
- **Payment types:**
  - Link payments (Stripe) - Stored in `paymentDetails.history`
  - Cash - Stored in `paymentDetails.history`
  - Check - Stored in `paymentDetails.history`
  - Zelle - Stored in `paymentDetails.history`

**Chyrris KAI expectation:**
```typescript
// Chyrris KAI is looking for:
db.collection('paymentHistory').get()

// But this collection DOESN'T EXIST in Firestore
```

**Options to Fix:**

#### Option A: Create `paymentHistory` collection in Firestore (RECOMMENDED)
- Modify Owl Fenc to write payment history to Firestore whenever a payment is recorded
- Keeps Chyrris KAI simple (just reads from Firestore)
- Real-time tracking without complex queries

**Implementation:**
```typescript
// In Owl Fenc - whenever a payment is recorded:
await db.collection('paymentHistory').add({
  userId: firebaseUid,
  projectId: project.id,
  amount: payment.amount,
  paymentType: 'cash' | 'check' | 'zelle' | 'stripe',
  status: 'pending' | 'completed',
  createdAt: FieldValue.serverTimestamp(),
  metadata: {
    invoiceId: payment.invoiceId,
    description: payment.description
  }
});
```

#### Option B: Query PostgreSQL from Chyrris KAI
- Add PostgreSQL connection to Chyrris KAI
- Query `projects` table and extract `paymentDetails.history`
- More complex, requires additional database connection

#### Option C: Sync existing PostgreSQL data to Firestore
- One-time migration script
- Ongoing sync whenever payments are updated
- Best of both worlds but requires maintenance

**Recommendation:** **Option A** - Start writing to Firestore going forward. Optionally run a one-time migration for historical data.

---

### 3. ❌ PDFs Showing 0

**Problem:** No PDF tracking system exists in Owl Fenc.

**Current State:**
- Chyrris KAI queries `pdf_logs` collection in Firestore
- Owl Fenc does NOT write to this collection
- PDFs are generated but not tracked

**Where PDFs are generated in Owl Fenc:**
- Invoice PDFs
- Estimate PDFs
- Contract PDFs
- Project summary PDFs

**Solution Required:**
Create `pdfTrackingService.ts` in Owl Fenc similar to `emailTrackingService.ts`:

```typescript
// server/services/pdfTrackingService.ts
export async function logPdfGenerated(pdfData: {
  userId: string;
  pdfType: 'invoice' | 'estimate' | 'contract' | 'project_summary' | 'other';
  documentId?: string;
  documentNumber?: string;
  success: boolean;
  errorMessage?: string;
}): Promise<string> {
  try {
    const pdfLog = {
      ...pdfData,
      generatedAt: Timestamp.now(),
    };
    
    const docRef = await db.collection('pdf_logs').add(pdfLog);
    console.log(`[PDF Tracking] Logged PDF: ${pdfData.pdfType} (${docRef.id})`);
    
    return docRef.id;
  } catch (error) {
    console.error('[PDF Tracking] Error logging PDF:', error);
    // Don't throw - PDF generation should not fail if tracking fails
    return '';
  }
}
```

**Integration Points:**
- `ModernPdfService.ts` - Main PDF generation service
- `NativePdfEngine.ts` - Native PDF engine
- Invoice generation routes
- Estimate generation routes
- Contract generation routes

**Priority:** LOW (as per user request)

---

### 4. ❌ Per-User Table NOT Respecting Date Filters

**Problem:** Date filters (Day/Month/Year/Custom/All Time) work for global metrics but NOT for per-user breakdown table.

**Root Cause:**
```typescript
// getUserUsageBreakdown() receives date parameters
export async function getUserUsageBreakdown(
  startDate?: string,
  endDate?: string
): Promise<UserUsageBreakdown[]>

// But the date filtering is applied AFTER fetching all documents
// This works but doesn't update when user changes date filter in UI
```

**Current Behavior:**
- User selects "This Month" filter
- Global metrics update ✅
- Per-user table shows ALL TIME data ❌

**Solution:**
The date filtering IS implemented in the backend, but the **frontend is not passing the date parameters** to the per-user query.

**Fix Required in Frontend:**
```typescript
// client/src/pages/UsageSystem.tsx
// CURRENT (WRONG):
const { data: userBreakdown } = trpc.owlfenc.getUserUsageBreakdown.useQuery({});

// SHOULD BE (CORRECT):
const { data: userBreakdown } = trpc.owlfenc.getUserUsageBreakdown.useQuery(
  getDateRangeParams(dateRange)
);
```

---

## Summary of Actions

| Issue | Status | Action Required |
|-------|--------|-----------------|
| **Contracts showing 0** | ✅ FIXED | Already updated query to filter only 'completed' and 'both_signed' |
| **Payments showing 0** | ⚠️ NEEDS DECISION | Choose Option A, B, or C above |
| **PDFs showing 0** | 📋 PLANNED | Implement pdfTrackingService.ts (LOW PRIORITY) |
| **Per-user date filters** | 🔧 NEEDS FIX | Update frontend to pass date parameters |

---

## Next Steps

1. ✅ **Test contracts fix** - Verify completed contracts now show correct count
2. ⚠️ **Decide on payments architecture** - Choose Option A, B, or C
3. 🔧 **Fix per-user date filtering** - Update frontend to pass date params
4. 📋 **Plan PDF tracking** - Implement when ready (low priority)

---

## Questions for User

1. **Payments:** Do you prefer Option A (write to Firestore going forward), Option B (query PostgreSQL), or Option C (sync both)?
2. **Historical data:** Should we migrate existing payment history from PostgreSQL to Firestore?
3. **PDF tracking:** When do you want to implement this? (You said low priority)
