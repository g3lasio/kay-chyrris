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
