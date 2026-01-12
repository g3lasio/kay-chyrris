/**
 * In-App Push Notifications Service
 * Handles creation, retrieval, and management of real-time push notifications
 */

import { getDb } from '../db';
import { inAppNotifications, notificationPreferences } from '../../drizzle/schema';
import { eq, and, desc, sql, or, isNull } from 'drizzle-orm';

export type NotificationPriority = 'info' | 'warning' | 'important' | 'critical';
export type NotificationCategory = 'payment' | 'contract' | 'user' | 'system' | 'lead' | 'contact' | 'pipeline';

export interface CreateNotificationInput {
  applicationId: number;
  userId?: string | null; // Null = broadcast to all users
  title: string;
  message: string;
  priority: NotificationPriority;
  category?: string;
  actionUrl?: string;
  actionLabel?: string;
  icon?: string;
  expiresAt?: Date;
  metadata?: Record<string, any>;
}

export interface NotificationFilters {
  userId?: string;
  applicationId: number;
  priority?: NotificationPriority;
  category?: string;
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Create a new in-app notification
 */
export async function createNotification(input: CreateNotificationInput) {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  const values: any = {
    applicationId: input.applicationId,
    userId: input.userId || null,
    title: input.title,
    message: input.message,
    priority: input.priority,
    category: input.category || null,
    actionUrl: input.actionUrl || null,
    actionLabel: input.actionLabel || null,
    icon: input.icon || null,
    expiresAt: input.expiresAt || null,
    metadata: input.metadata || null,
    read: false,
    archived: false,
  };
  
  const [notification] = await db.insert(inAppNotifications).values(values).returning();

  console.log(`[Notifications] Created ${input.priority} notification: "${input.title}" for app ${input.applicationId}`);
  
  return notification;
}

/**
 * Get notifications for a user with filters
 */
export async function getNotifications(filters: NotificationFilters) {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  const conditions = [
    eq(inAppNotifications.applicationId, filters.applicationId),
    eq(inAppNotifications.archived, false),
  ];

  // User-specific or broadcast notifications
  if (filters.userId) {
    conditions.push(
      or(
        eq(inAppNotifications.userId, filters.userId),
        isNull(inAppNotifications.userId) // Broadcast notifications
      )!
    );
  }

  if (filters.priority) {
    conditions.push(eq(inAppNotifications.priority, filters.priority));
  }

  if (filters.category) {
    conditions.push(eq(inAppNotifications.category, filters.category));
  }

  if (filters.unreadOnly) {
    conditions.push(eq(inAppNotifications.read, false));
  }

  const notifications = await db
    .select()
    .from(inAppNotifications)
    .where(and(...conditions))
    .orderBy(desc(inAppNotifications.createdAt))
    .limit(filters.limit || 50)
    .offset(filters.offset || 0);

  return notifications;
}

/**
 * Get unread notification count for a user
 */
export async function getUnreadCount(userId: string, applicationId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(inAppNotifications)
    .where(
      and(
        eq(inAppNotifications.applicationId, applicationId),
        eq(inAppNotifications.read, false),
        eq(inAppNotifications.archived, false),
        or(
          eq(inAppNotifications.userId, userId),
          isNull(inAppNotifications.userId)
        )!
      )
    );

  return Number(result[0]?.count || 0);
}

/**
 * Mark a notification as read
 */
export async function markAsRead(notificationId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  await db
    .update(inAppNotifications)
    .set({
      read: true,
      readAt: new Date(),
    })
    .where(eq(inAppNotifications.id, notificationId));

  console.log(`[Notifications] Marked notification ${notificationId} as read`);
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllAsRead(userId: string, applicationId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  const result = await db
    .update(inAppNotifications)
    .set({
      read: true,
      readAt: new Date(),
    })
    .where(
      and(
        eq(inAppNotifications.applicationId, applicationId),
        eq(inAppNotifications.read, false),
        or(
          eq(inAppNotifications.userId, userId),
          isNull(inAppNotifications.userId)
        )!
      )
    );

  console.log(`[Notifications] Marked all notifications as read for user ${userId} in app ${applicationId}`);
  
  return result;
}

/**
 * Archive a notification
 */
export async function archiveNotification(notificationId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  await db
    .update(inAppNotifications)
    .set({ archived: true })
    .where(eq(inAppNotifications.id, notificationId));

  console.log(`[Notifications] Archived notification ${notificationId}`);
}

/**
 * Delete old expired notifications (cleanup job)
 */
export async function cleanupExpiredNotifications() {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  const result = await db
    .delete(inAppNotifications)
    .where(
      and(
        sql`${inAppNotifications.expiresAt} IS NOT NULL`,
        sql`${inAppNotifications.expiresAt} < NOW()`
      )
    );

  console.log(`[Notifications] Cleaned up expired notifications`);
  
  return result;
}

/**
 * Get or create notification preferences for a user
 */
export async function getUserPreferences(userId: string, applicationId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  const existing = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.applicationId, applicationId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  // Create default preferences
  const values: any = {
    userId,
    applicationId,
    enabled: true,
    minPriority: 'info',
    categoriesEnabled: ['payment', 'contract', 'user', 'system', 'lead', 'contact', 'pipeline'],
  };
  
  const [prefs] = await db.insert(notificationPreferences).values(values).returning();

  return prefs;
}

/**
 * Update notification preferences
 */
export async function updateUserPreferences(
  userId: string,
  applicationId: number,
  updates: Partial<{
    enabled: boolean;
    minPriority: NotificationPriority;
    categoriesEnabled: string[];
    quietHoursStart: string;
    quietHoursEnd: string;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error('Database connection failed');
  
  const updateValues: any = { ...updates };
  
  await db
    .update(notificationPreferences)
    .set(updateValues)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.applicationId, applicationId)
      )
    );

  console.log(`[Notifications] Updated preferences for user ${userId} in app ${applicationId}`);
}

// ================================================
// HELPER FUNCTIONS FOR COMMON NOTIFICATIONS
// ================================================

/**
 * Send a payment notification (Owl Fenc)
 */
export async function notifyPaymentReceived(params: {
  userId: string;
  amount: number;
  clientName: string;
  paymentId: string;
}) {
  return createNotification({
    applicationId: 1, // Owl Fenc
    userId: params.userId,
    title: 'Nuevo pago recibido',
    message: `${params.clientName} pagó $${params.amount.toLocaleString()}`,
    priority: 'important',
    category: 'payment',
    actionUrl: `/owlfenc/payments/${params.paymentId}`,
    actionLabel: 'Ver pago',
    icon: '💰',
  });
}

/**
 * Send a contract signed notification (Owl Fenc)
 */
export async function notifyContractSigned(params: {
  userId: string;
  clientName: string;
  contractId: string;
}) {
  return createNotification({
    applicationId: 1, // Owl Fenc
    userId: params.userId,
    title: 'Contrato firmado',
    message: `${params.clientName} firmó el contrato`,
    priority: 'important',
    category: 'contract',
    actionUrl: `/owlfenc/contracts/${params.contractId}`,
    actionLabel: 'Ver contrato',
    icon: '✍️',
  });
}

/**
 * Send a new user notification (Owl Fenc)
 */
export async function notifyNewUser(params: {
  userName: string;
  userEmail: string;
  plan: string;
}) {
  return createNotification({
    applicationId: 1, // Owl Fenc
    userId: null, // Broadcast to all admins
    title: 'Nuevo usuario registrado',
    message: `${params.userName} (${params.userEmail}) se registró en plan ${params.plan}`,
    priority: 'info',
    category: 'user',
    actionUrl: '/owlfenc/users',
    actionLabel: 'Ver usuarios',
    icon: '👤',
  });
}

/**
 * Send a new lead notification (LeadPrime)
 */
export async function notifyNewLead(params: {
  userId: string;
  leadName: string;
  leadSource: string;
  leadId: string;
}) {
  return createNotification({
    applicationId: 2, // LeadPrime
    userId: params.userId,
    title: 'Nuevo lead',
    message: `${params.leadName} desde ${params.leadSource}`,
    priority: 'important',
    category: 'lead',
    actionUrl: `/leadprime/leads/${params.leadId}`,
    actionLabel: 'Ver lead',
    icon: '🎯',
  });
}

/**
 * Send a critical system error notification
 */
export async function notifySystemError(params: {
  applicationId: number;
  errorMessage: string;
  errorDetails?: string;
}) {
  return createNotification({
    applicationId: params.applicationId,
    userId: null, // Broadcast to all admins
    title: '🚨 Error crítico en sistema',
    message: params.errorMessage,
    priority: 'critical',
    category: 'system',
    actionUrl: '/settings/logs',
    actionLabel: 'Ver logs',
    icon: '⚠️',
    metadata: { details: params.errorDetails },
  });
}
