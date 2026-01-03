import { getFirestore, getAuth } from './firebase';

export interface OwlFencUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  phoneNumber: string | null;
  createdAt: string;
  lastSignInTime: string | null;
  disabled: boolean;
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
 * Get dashboard statistics from Firebase
 */
export async function getOwlFencDashboardStats(): Promise<OwlFencDashboardStats> {
  try {
    const db = getFirestore();
    const auth = getAuth();

    // Get counts from different collections
    const [usersResult, clientsSnapshot, contractsSnapshot, invoicesSnapshot] = await Promise.all([
      auth.listUsers(1000),
      db.collection('clients').get(),
      db.collection('contracts').get(),
      db.collection('invoices').get(),
    ]);

    const totalUsers = usersResult.users.length;
    const totalClients = clientsSnapshot.size;
    const totalContracts = contractsSnapshot.size;
    const totalInvoices = invoicesSnapshot.size;

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
      totalProjects: 0, // TODO: Add projects collection if exists
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
 */
export async function getSystemUsageMetrics() {
  try {
    const db = getFirestore();
    
    // Helper functions for date filtering
    const getTodayStart = () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return today;
    };
    
    const getMonthStart = () => {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), 1);
    };
    
    // Get total counts for all collections
    const [
      clientsSnapshot,
      contractsSnapshot,
      invoicesSnapshot,
      estimatesSnapshot,
      projectsSnapshot,
      paymentsSnapshot,
      permitSearchesSnapshot,
      propertyVerificationsSnapshot,
      dualSignatureContractsSnapshot,
      sharedEstimatesSnapshot,
      contractHistorySnapshot,
      emailsTodaySnapshot,
      emailsMonthSnapshot,
      pdfsTodaySnapshot,
      pdfsMonthSnapshot
    ] = await Promise.all([
      db.collection('clients').count().get(),
      db.collection('contracts').count().get(),
      db.collection('invoices').count().get(),
      db.collection('estimates').count().get(),
      db.collection('projects').count().get(),
      db.collection('paymentHistory').count().get(),
      
      // NEW: High-priority metrics
      db.collection('permit_search_history').count().get().catch(() => ({ data: () => ({ count: 0 }) })),
      // Property verifications from PostgreSQL
      (async () => {
        const { getPropertyVerificationsCount } = await import('./owlfenc-subscriptions.js');
        const count = await getPropertyVerificationsCount();
        return { data: () => ({ count }) };
      })(),
      db.collection('dualSignatureContracts').count().get().catch(() => ({ data: () => ({ count: 0 }) })),
      db.collection('shared_estimates').count().get().catch(() => ({ data: () => ({ count: 0 }) })),
      db.collection('contractHistory').count().get().catch(() => ({ data: () => ({ count: 0 }) })),
      
      // Emails sent TODAY (may not exist yet, will return 0)
      db.collection('email_logs')
        .where('sentAt', '>=', getTodayStart())
        .count().get()
        .catch(() => ({ data: () => ({ count: 0 }) })),
      
      // Emails sent THIS MONTH
      db.collection('email_logs')
        .where('sentAt', '>=', getMonthStart())
        .count().get()
        .catch(() => ({ data: () => ({ count: 0 }) })),
      
      // PDFs generated TODAY
      db.collection('pdf_logs')
        .where('generatedAt', '>=', getTodayStart())
        .count().get()
        .catch(() => ({ data: () => ({ count: 0 }) })),
      
      // PDFs generated THIS MONTH
      db.collection('pdf_logs')
        .where('generatedAt', '>=', getMonthStart())
        .count().get()
        .catch(() => ({ data: () => ({ count: 0 }) })),
    ]);
    
    const emailsSentToday = emailsTodaySnapshot.data().count;
    const emailDailyLimit = 500; // Resend free tier limit
    
    return {
      // Core metrics
      totalClients: clientsSnapshot.data().count,
      totalContracts: contractsSnapshot.data().count,
      totalInvoices: invoicesSnapshot.data().count,
      totalEstimates: estimatesSnapshot.data().count,
      totalProjects: projectsSnapshot.data().count,
      totalPayments: paymentsSnapshot.data().count,
      
      // NEW: High-priority metrics
      totalPermitSearches: permitSearchesSnapshot.data().count,
      totalPropertyVerifications: propertyVerificationsSnapshot.data().count,
      totalDualSignatureContracts: dualSignatureContractsSnapshot.data().count,
      totalSharedEstimates: sharedEstimatesSnapshot.data().count,
      totalContractModifications: contractHistorySnapshot.data().count,
      
      // Email tracking (Resend limit: 500/day)
      emailsSentToday,
      emailsSentMonth: emailsMonthSnapshot.data().count,
      emailDailyLimit,
      emailUsagePercentage: (emailsSentToday / emailDailyLimit) * 100,
      
      // PDF tracking
      pdfsGeneratedToday: pdfsTodaySnapshot.data().count,
      pdfsGeneratedMonth: pdfsMonthSnapshot.data().count,
    };
  } catch (error) {
    console.error('[Firebase] Error fetching system usage metrics:', error);
    throw error;
  }
}

/**
 * Get per-user usage breakdown
 */
export async function getUserUsageBreakdown() {
  try {
    const db = getFirestore();
    const auth = getAuth();
    
    // Get all users
    const listUsersResult = await auth.listUsers(1000);
    
    // For each user, count their documents across ALL collections
    const userUsagePromises = listUsersResult.users.map(async (userRecord) => {
      const userId = userRecord.uid;
      
      // Count documents where userId field matches (or firebaseUserId for estimates)
      const [
        clientsSnapshot,
        contractsSnapshot,
        invoicesSnapshot,
        estimatesSnapshot,
        projectsSnapshot,
        paymentsSnapshot,
        permitSearchesSnapshot,
        propertyVerificationsCount,
        dualSignatureContractsSnapshot,
        sharedEstimatesSnapshot,
        contractHistorySnapshot,
        emailsSnapshot,
        pdfsSnapshot
      ] = await Promise.all([
        db.collection('clients').where('userId', '==', userId).count().get(),
        db.collection('contracts').where('userId', '==', userId).count().get(),
        db.collection('invoices').where('userId', '==', userId).count().get(),
        // NOTE: estimates uses 'firebaseUserId' instead of 'userId' (legacy)
        db.collection('estimates').where('firebaseUserId', '==', userId).count().get(),
        db.collection('projects').where('userId', '==', userId).count().get(),
        db.collection('paymentHistory').where('userId', '==', userId).count().get(),
        
        // NEW: High-priority metrics
        db.collection('permit_search_history').where('userId', '==', userId).count().get().catch(() => ({ data: () => ({ count: 0 }) })),
        // Property verifications from PostgreSQL
        (async () => {
          const { getPropertyVerificationsCount } = await import('./owlfenc-subscriptions.js');
          return await getPropertyVerificationsCount(userId);
        })(),
        db.collection('dualSignatureContracts').where('userId', '==', userId).count().get().catch(() => ({ data: () => ({ count: 0 }) })),
        db.collection('shared_estimates').where('userId', '==', userId).count().get().catch(() => ({ data: () => ({ count: 0 }) })),
        db.collection('contractHistory').where('userId', '==', userId).count().get().catch(() => ({ data: () => ({ count: 0 }) })),
        
        // Email and PDF logs (may not exist yet, will return 0)
        db.collection('email_logs').where('userId', '==', userId).count().get().catch(() => ({ data: () => ({ count: 0 }) })),
        db.collection('pdf_logs').where('userId', '==', userId).count().get().catch(() => ({ data: () => ({ count: 0 }) })),
      ]);
      
      return {
        uid: userRecord.uid,
        email: userRecord.email || 'N/A',
        displayName: userRecord.displayName || 'N/A',
        clientsCount: clientsSnapshot.data().count,
        contractsCount: contractsSnapshot.data().count,
        invoicesCount: invoicesSnapshot.data().count,
        estimatesCount: estimatesSnapshot.data().count,
        projectsCount: projectsSnapshot.data().count,
        paymentsCount: paymentsSnapshot.data().count,
        
        // NEW: High-priority metrics
        permitSearchesCount: permitSearchesSnapshot.data().count,
        propertyVerificationsCount: propertyVerificationsCount,
        dualSignatureContractsCount: dualSignatureContractsSnapshot.data().count,
        sharedEstimatesCount: sharedEstimatesSnapshot.data().count,
        contractModificationsCount: contractHistorySnapshot.data().count,
        
        emailsSentCount: emailsSnapshot.data().count,
        pdfsGeneratedCount: pdfsSnapshot.data().count,
      };
    });
    
    const userUsage = await Promise.all(userUsagePromises);
    
    // Filter out users with zero activity
    return userUsage.filter(user => 
      user.clientsCount > 0 || 
      user.contractsCount > 0 || 
      user.invoicesCount > 0 || 
      user.estimatesCount > 0 ||
      user.projectsCount > 0 ||
      user.paymentsCount > 0 ||
      user.permitSearchesCount > 0 ||
      user.dualSignatureContractsCount > 0 ||
      user.sharedEstimatesCount > 0 ||
      user.contractModificationsCount > 0 ||
      user.emailsSentCount > 0 ||
      user.pdfsGeneratedCount > 0
    );
  } catch (error) {
    console.error('[Firebase] Error fetching user usage breakdown:', error);
    throw error;
  }
}
