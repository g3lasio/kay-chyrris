import { getFirestore, getAuth } from './firebase';
import { getOwlFencDb } from './owlfenc-db';
import { sql } from 'drizzle-orm';

export interface OwlFencUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  phoneNumber: string | null;
  createdAt: string;
  lastSignInTime: string | null;
  disabled: boolean;
}

export interface OwlFencUserWithPlan extends OwlFencUser {
  planName: string;
  planCode: string | null;
  planPrice: number;
  subscriptionStatus: string | null;
}

export interface OwlFencClient {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  country: string;
  createdAt: string;
  classification: string;
  openBalance: number;
}

export interface OwlFencDashboardStats {
  totalUsers: number;
  totalClients: number;
  totalContracts: number;
  totalProjects: number;
  totalInvoices: number;
  activeUsers: number;
  newUsersThisMonth: number;
  recentActivity: {
    type: string;
    description: string;
    timestamp: string;
  }[];
}

/**
 * Get all users from Firebase Authentication
 */
export async function getOwlFencUsers(): Promise<OwlFencUser[]> {
  try {
    const auth = getAuth();
    const listUsersResult = await auth.listUsers(1000); // Max 1000 users per request

    const users: OwlFencUser[] = listUsersResult.users.map(userRecord => ({
      uid: userRecord.uid,
      email: userRecord.email || null,
      displayName: userRecord.displayName || null,
      phoneNumber: userRecord.phoneNumber || null,
      createdAt: userRecord.metadata.creationTime,
      lastSignInTime: userRecord.metadata.lastSignInTime || null,
      disabled: userRecord.disabled,
    }));

    console.log(`[Firebase] Found ${users.length} users in Authentication`);
    return users;
  } catch (error) {
    console.error('[Firebase] Error fetching users:', error);
    return [];
  }
}

/**
 * Get all clients from Firestore
 */
export async function getOwlFencClients(): Promise<OwlFencClient[]> {
  try {
    const db = getFirestore();
    const clientsSnapshot = await db.collection('clients').get();

    const clients: OwlFencClient[] = clientsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name || 'Unknown',
        email: data.email || '',
        phone: data.phone || '',
        address: data.address || '',
        city: data.city || '',
        country: data.country || '',
        createdAt: data.createdAt || '',
        classification: data.classification || 'cliente',
        openBalance: parseFloat(data['open balance']) || 0,
      };
    });

    console.log(`[Firebase] Found ${clients.length} clients in Firestore`);
    return clients;
  } catch (error) {
    console.error('[Firebase] Error fetching clients:', error);
    return [];
  }
}

/**
 * Get dashboard statistics from Firebase + PostgreSQL
 * CORRECTED: Uses correct collection paths matching Owl Fenc app
 */
export async function getOwlFencDashboardStats(): Promise<OwlFencDashboardStats> {
  try {
    const db = getFirestore();
    const auth = getAuth();

    // Get counts from different collections
    // CORRECTED: Using 'contracts' instead of 'contractHistory'
    // CORRECTED: Invoices come from PostgreSQL project_payments, not Firestore
    const [usersResult, clientsSnapshot, contractsSnapshot, estimatesSnapshot] = await Promise.all([
      auth.listUsers(1000),
      db.collection('clients').get(),
      db.collection('contracts').get(),
      db.collection('estimates').get(),
    ]);

    // Get invoice count from PostgreSQL (project_payments with invoiceNumber)
    let totalInvoices = 0;
    try {
      const pgDb = getOwlFencDb();
      if (pgDb) {
        const invoiceResult = await pgDb.execute(sql`
          SELECT COUNT(*) as count FROM project_payments WHERE invoice_number IS NOT NULL
        `);
        totalInvoices = parseInt(String(invoiceResult.rows[0]?.count || '0'), 10);
      }
    } catch (err) {
      console.error('[Firebase] Error fetching invoice count from PostgreSQL:', err);
    }

    const totalUsers = usersResult.users.length;
    const totalClients = clientsSnapshot.size;
    // Count contracts (all statuses are valid - they represent created contracts)
    const totalContracts = contractsSnapshot.size;

    // Calculate active users (signed in within last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const activeUsers = usersResult.users.filter(user => {
      if (!user.metadata.lastSignInTime) return false;
      const lastSignIn = new Date(user.metadata.lastSignInTime);
      return lastSignIn > thirtyDaysAgo;
    }).length;

    // Calculate new users this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const newUsersThisMonth = usersResult.users.filter(user => {
      const createdAt = new Date(user.metadata.creationTime);
      return createdAt >= startOfMonth;
    }).length;

    // Get recent activity (last 10 contracts)
    const recentContracts = contractsSnapshot.docs
      .map(doc => {
        const data = doc.data();
        return {
          type: 'contract',
          description: `New contract created`,
          timestamp: data.createdAt || new Date().toISOString(),
        };
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10);

    console.log('[Firebase] Dashboard stats:', {
      totalUsers,
      totalClients,
      totalContracts,
      totalInvoices,
      activeUsers,
      newUsersThisMonth,
    });

    return {
      totalUsers,
      totalClients,
      totalContracts,
      totalProjects: estimatesSnapshot.size, // Projects = estimates in Owl Fenc
      totalInvoices,
      activeUsers,
      newUsersThisMonth,
      recentActivity: recentContracts,
    };
  } catch (error) {
    console.error('[Firebase] Error fetching dashboard stats:', error);
    return {
      totalUsers: 0,
      totalClients: 0,
      totalContracts: 0,
      totalProjects: 0,
      totalInvoices: 0,
      activeUsers: 0,
      newUsersThisMonth: 0,
      recentActivity: [],
    };
  }
}

/**
 * Search users by email or name
 */
export async function searchOwlFencUsers(query: string): Promise<OwlFencUser[]> {
  try {
    const allUsers = await getOwlFencUsers();
    const lowerQuery = query.toLowerCase();

    return allUsers.filter(user => {
      const email = (user.email || '').toLowerCase();
      const name = (user.displayName || '').toLowerCase();
      return email.includes(lowerQuery) || name.includes(lowerQuery);
    });
  } catch (error) {
    console.error('[Firebase] Error searching users:', error);
    return [];
  }
}

/**
 * Get user by UID
 */
export async function getOwlFencUserById(uid: string): Promise<OwlFencUser | null> {
  try {
    const auth = getAuth();
    const userRecord = await auth.getUser(uid);

    return {
      uid: userRecord.uid,
      email: userRecord.email || null,
      displayName: userRecord.displayName || null,
      phoneNumber: userRecord.phoneNumber || null,
      createdAt: userRecord.metadata.creationTime,
      lastSignInTime: userRecord.metadata.lastSignInTime || null,
      disabled: userRecord.disabled,
    };
  } catch (error) {
    console.error('[Firebase] Error fetching user by ID:', error);
    return null;
  }
}

/**
 * Get system-wide usage metrics
 * CORRECTED: Uses correct Firestore collection paths matching Owl Fenc app
 * 
 * Data source mapping (verified against Owl Fenc codebase):
 * - Clients: Firestore 'clients' collection
 * - Contracts: Firestore 'contracts' collection (regular contracts)
 * - Invoices: PostgreSQL 'project_payments' table (invoices = payment links with invoice numbers)
 * - Estimates: Firestore 'estimates' collection
 * - Permits: Firestore 'searches/permits/history' collection
 * - Properties: Firestore 'searches/property/history' collection
 * - Dual Signatures: Firestore 'dualSignatureContracts' collection
 * 
 * @param startDate Optional start date for filtering (ISO string)
 * @param endDate Optional end date for filtering (ISO string)
 */
export async function getSystemUsageMetrics(startDate?: string, endDate?: string) {
  try {
    const db = getFirestore();
    
    // Use custom date range if provided, otherwise use default (all time)
    const filterStartDate = startDate ? new Date(startDate) : null;
    const filterEndDate = endDate ? new Date(endDate) : null;
    
    // CORRECTED: Get total counts from CORRECT collections
    const [
      clientsSnapshot,
      contractsSnapshot,          // FIXED: was 'contractHistory', now 'contracts'
      estimatesSnapshot,
      permitSearchesSnapshot,     // FIXED: was 'permit_search_history', now 'searches/permits/history'
      propertySearchesSnapshot,   // FIXED: was PostgreSQL, now Firestore 'searches/property/history'
      dualSignatureContractsSnapshot,
    ] = await Promise.all([
      db.collection('clients').get(),
      db.collection('contracts').get(),                      // FIXED
      db.collection('estimates').get(),
      db.collection('searches/permits/history').get()        // FIXED
        .catch(() => ({ docs: [], size: 0 })),
      db.collection('searches/property/history').get()       // FIXED
        .catch(() => ({ docs: [], size: 0 })),
      db.collection('dualSignatureContracts').get()
        .catch(() => ({ docs: [], size: 0 })),
    ]);

    // Get invoice count from PostgreSQL (project_payments = invoices in Owl Fenc)
    let totalInvoices = 0;
    try {
      const pgDb = getOwlFencDb();
      if (pgDb) {
        const invoiceResult = await pgDb.execute(sql`
          SELECT COUNT(*) as count FROM project_payments WHERE invoice_number IS NOT NULL
        `);
        totalInvoices = parseInt(String(invoiceResult.rows[0]?.count || '0'), 10);
      }
    } catch (err) {
      console.error('[Usage] Error fetching invoice count from PostgreSQL:', err);
    }
    
    // Filter documents in memory if date range is provided
    const filterDocs = (snapshot: any) => {
      let docs = snapshot.docs || [];
      
      if (!filterStartDate || !filterEndDate) return docs.length;
      
      return docs.filter((doc: any) => {
        const data = doc.data();
        const createdAt = data.createdAt;
        
        if (!createdAt) return false;
        
        // Handle different date formats (Timestamp, Date, string)
        let docDate: Date;
        if (createdAt.toDate) {
          docDate = createdAt.toDate(); // Firestore Timestamp
        } else if (createdAt instanceof Date) {
          docDate = createdAt;
        } else {
          docDate = new Date(createdAt); // ISO string
        }
        
        return docDate >= filterStartDate && docDate <= filterEndDate;
      }).length;
    };
    
    return {
      // Core metrics (filtered in memory)
      totalClients: filterDocs(clientsSnapshot),
      totalContracts: filterDocs(contractsSnapshot),
      totalInvoices,  // From PostgreSQL - no date filtering needed for now
      totalEstimates: filterDocs(estimatesSnapshot),
      totalProjects: filterDocs(estimatesSnapshot), // Projects = estimates in Owl Fenc
      
      // Search metrics
      totalPermitSearches: filterDocs(permitSearchesSnapshot),
      totalPropertyVerifications: filterDocs(propertySearchesSnapshot),
      
      // Contract metrics
      totalDualSignatureContracts: filterDocs(dualSignatureContractsSnapshot),
      totalContractModifications: 0, // Not tracked separately in Owl Fenc
      
      // Email/PDF tracking - NOT currently logged by Owl Fenc
      // These will show 0 until Owl Fenc implements logging
      emailsSentToday: 0,
      emailsSentMonth: 0,
      emailDailyLimit: 500,
      emailUsagePercentage: 0,
      pdfsGeneratedToday: 0,
      pdfsGeneratedMonth: 0,
    };
  } catch (error) {
    console.error('[Firebase] Error fetching system usage metrics:', error);
    throw error;
  }
}

/**
 * Get per-user usage breakdown
 * CORRECTED: Uses correct Firestore collection paths matching Owl Fenc app
 * 
 * Data source mapping (verified against Owl Fenc codebase):
 * - Clients: Firestore 'clients' where userId == Firebase UID
 * - Contracts: Firestore 'contracts' where userId == Firebase UID
 * - Invoices: PostgreSQL 'project_payments' joined via users.firebase_uid
 * - Estimates: Firestore 'estimates' where userId == Firebase UID
 * - Permits: Firestore 'searches/permits/history' where userId == Firebase UID
 * - Properties: Firestore 'searches/property/history' where userId == Firebase UID
 * - Dual Signatures: Firestore 'dualSignatureContracts' where userId == Firebase UID
 * 
 * @param startDate Optional start date for filtering (ISO string)
 * @param endDate Optional end date for filtering (ISO string)
 */
export async function getUserUsageBreakdown(startDate?: string, endDate?: string) {
  try {
    const db = getFirestore();
    const auth = getAuth();
    
    // Get all users
    const listUsersResult = await auth.listUsers(1000);
    
    // Use custom date range if provided
    const filterStartDate = startDate ? new Date(startDate) : null;
    const filterEndDate = endDate ? new Date(endDate) : null;
    
    // Get invoice counts per user from PostgreSQL (project_payments = invoices)
    const invoiceCountMap = new Map<string, number>();
    try {
      const pgDb = getOwlFencDb();
      if (pgDb) {
        const invoiceResult = await pgDb.execute(sql`
          SELECT u.firebase_uid as "firebaseUid", COUNT(pp.id) as count
          FROM project_payments pp
          JOIN users u ON pp.user_id = u.id
          WHERE pp.invoice_number IS NOT NULL AND u.firebase_uid IS NOT NULL
          GROUP BY u.firebase_uid
        `);
        for (const row of invoiceResult.rows) {
          invoiceCountMap.set(
            String(row.firebaseUid),
            parseInt(String(row.count || '0'), 10)
          );
        }
        console.log(`[Usage] Found invoice data for ${invoiceCountMap.size} users from PostgreSQL`);
      }
    } catch (err) {
      console.error('[Usage] Error fetching invoice breakdown from PostgreSQL:', err);
    }
    
    // For each user, count their documents across ALL collections
    const userUsagePromises = listUsersResult.users.map(async (userRecord) => {
      const userId = userRecord.uid;
      
      // CORRECTED: Count documents from CORRECT collections with CORRECT field names
      const [
        clientsSnapshot,
        contractsSnapshot,          // FIXED: was 'contractHistory', now 'contracts'
        estimatesSnapshot,          // FIXED: was 'firebaseUserId', now 'userId'
        permitSearchesSnapshot,     // FIXED: was 'permit_search_history', now 'searches/permits/history'
        propertySearchesSnapshot,   // FIXED: was PostgreSQL, now Firestore
        dualSignatureContractsSnapshot,
      ] = await Promise.all([
        // Clients - Firestore 'clients' collection (CORRECT, no change needed)
        db.collection('clients').where('userId', '==', userId).get(),
        
        // Contracts - FIXED: Read from 'contracts' instead of 'contractHistory'
        db.collection('contracts').where('userId', '==', userId).get(),
        
        // Estimates - FIXED: Field name is 'userId' not 'firebaseUserId'
        db.collection('estimates').where('userId', '==', userId).get(),
        
        // Permit Searches - FIXED: Collection path is 'searches/permits/history'
        db.collection('searches/permits/history').where('userId', '==', userId).get()
          .catch(() => ({ docs: [], size: 0 })),
        
        // Property Verifications - FIXED: Read from Firestore 'searches/property/history'
        db.collection('searches/property/history').where('userId', '==', userId).get()
          .catch(() => ({ docs: [], size: 0 })),
        
        // Dual Signature Contracts - CORRECT, no change needed
        db.collection('dualSignatureContracts').where('userId', '==', userId).get()
          .catch(() => ({ docs: [], size: 0 })),
      ]);
      
      // Filter documents in memory if date range is provided
      const filterUserDocs = (snapshot: any) => {
        if (!snapshot || !snapshot.docs) return 0;
        if (!filterStartDate || !filterEndDate) return snapshot.size || snapshot.docs.length;
        
        return snapshot.docs.filter((doc: any) => {
          const data = doc.data();
          const createdAt = data.createdAt;
          
          if (!createdAt) return false;
          
          // Handle different date formats (Timestamp, Date, string)
          let docDate: Date;
          if (createdAt.toDate) {
            docDate = createdAt.toDate(); // Firestore Timestamp
          } else if (createdAt instanceof Date) {
            docDate = createdAt;
          } else {
            docDate = new Date(createdAt); // ISO string
          }
          
          return docDate >= filterStartDate && docDate <= filterEndDate;
        }).length;
      };
      
      const clientsCount = filterUserDocs(clientsSnapshot);
      const contractsCount = filterUserDocs(contractsSnapshot);
      const estimatesCount = filterUserDocs(estimatesSnapshot);
      const invoicesCount = invoiceCountMap.get(userId) || 0;
      
      return {
        uid: userRecord.uid,
        email: userRecord.email || 'N/A',
        displayName: userRecord.displayName || 'N/A',
        clientsCount,
        contractsCount,
        invoicesCount,
        estimatesCount,
        projectsCount: estimatesCount, // Projects = estimates in Owl Fenc
        
        // Search metrics
        permitSearchesCount: filterUserDocs(permitSearchesSnapshot),
        propertyVerificationsCount: filterUserDocs(propertySearchesSnapshot),
        
        // Contract metrics
        dualSignatureContractsCount: filterUserDocs(dualSignatureContractsSnapshot),
        contractModificationsCount: 0, // Not tracked separately in Owl Fenc
        
        // PDF tracking - Not currently logged by Owl Fenc
        pdfsGeneratedCount: 0,
      };
    });
    
    const userUsage = await Promise.all(userUsagePromises);
    
    // Return ALL users including those with zero activity
    return userUsage;
  } catch (error) {
    console.error('[Firebase] Error fetching user usage breakdown:', error);
    throw error;
  }
}


/**
 * Get all users from Firebase Authentication with their subscription plans from PostgreSQL
 * Merges Firebase Auth data with PostgreSQL subscription data
 */
export async function getOwlFencUsersWithPlans(): Promise<OwlFencUserWithPlan[]> {
  try {
    // Step 1: Get all users from Firebase Authentication
    const firebaseUsers = await getOwlFencUsers();
    console.log(`[Firebase] Retrieved ${firebaseUsers.length} users from Firebase Auth`);

    // Step 2: Get all users with subscriptions from PostgreSQL
    const db = getOwlFencDb();
    if (!db) {
      console.warn('[Firebase] PostgreSQL not available, returning users with default free plan');
      return firebaseUsers.map(user => ({
        ...user,
        planName: 'Primo Chambeador',
        planCode: 'free',
        planPrice: 0,
        subscriptionStatus: null,
      }));
    }

    // Query PostgreSQL for all users with their subscription info
    const pgUsersResult = await db.execute(sql`
      SELECT 
        u.firebase_uid as "firebaseUid",
        sp.name as "planName",
        sp.code as "planCode",
        sp.price as "planPrice",
        us.status as "subscriptionStatus"
      FROM users u
      LEFT JOIN user_subscriptions us ON u.id = us.user_id AND us.status = 'active'
      LEFT JOIN subscription_plans sp ON us.plan_id = sp.id
      WHERE u.firebase_uid IS NOT NULL
    `);

    // Create a map of firebase_uid -> subscription data
    const subscriptionMap = new Map<string, {
      planName: string;
      planCode: string | null;
      planPrice: number;
      subscriptionStatus: string | null;
    }>();

    for (const row of pgUsersResult.rows) {
      const firebaseUid = row.firebaseUid as string;
      subscriptionMap.set(firebaseUid, {
        planName: (row.planName as string) || 'Primo Chambeador',
        planCode: (row.planCode as string) || 'free',
        planPrice: row.planPrice ? Number(row.planPrice) : 0,
        subscriptionStatus: (row.subscriptionStatus as string) || null,
      });
    }

    console.log(`[Firebase] Found ${subscriptionMap.size} users in PostgreSQL with subscription data`);

    // Step 3: Merge Firebase users with PostgreSQL subscription data
    const usersWithPlans: OwlFencUserWithPlan[] = firebaseUsers.map(user => {
      const subscription = subscriptionMap.get(user.uid);
      
      if (subscription) {
        return {
          ...user,
          ...subscription,
        };
      } else {
        // User not in PostgreSQL or no active subscription - default to free plan
        return {
          ...user,
          planName: 'Primo Chambeador',
          planCode: 'free',
          planPrice: 0,
          subscriptionStatus: null,
        };
      }
    });

    console.log(`[Firebase] Successfully merged ${usersWithPlans.length} users with plan data`);
    return usersWithPlans;
  } catch (error) {
    console.error('[Firebase] Error fetching users with plans:', error);
    // Fallback: return basic users with free plan
    const firebaseUsers = await getOwlFencUsers();
    return firebaseUsers.map(user => ({
      ...user,
      planName: 'Primo Chambeador',
      planCode: 'free',
      planPrice: 0,
      subscriptionStatus: null,
    }));
  }
}
