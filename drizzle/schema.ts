import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, boolean, json, index, time } from "drizzle-orm/mysql-core";

/**
 * CHYRRIS KAI - Multi-Application Admin Control Platform
 * Database Schema for managing Owl Fenc, LeadPrime, and future applications
 */

// ================================================
// ADMIN USERS & AUTHENTICATION
// ================================================

export const adminUsers = mysqlTable("admin_users", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  role: mysqlEnum("role", ["super_admin", "admin", "viewer"]).default("admin").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const otpCodes = mysqlTable("otp_codes", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 255 }).notNull(),
  code: varchar("code", { length: 6 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const adminSessions = mysqlTable("admin_sessions", {
  id: varchar("id", { length: 255 }).primaryKey(),
  adminUserId: int("admin_user_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ================================================
// APPLICATIONS REGISTRY
// ================================================

export const applications = mysqlTable("applications", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  description: text("description"),
  databaseUrl: text("database_url").notNull(),
  databaseType: varchar("database_type", { length: 50 }).default("postgresql").notNull(),
  status: mysqlEnum("status", ["active", "inactive", "maintenance"]).default("active").notNull(),
  iconUrl: text("icon_url"),
  color: varchar("color", { length: 7 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

// ================================================
// NOTIFICATION CAMPAIGNS
// ================================================

export const notificationCampaigns = mysqlTable("notification_campaigns", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: int("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  message: text("message").notNull(),
  targetSegment: json("target_segment").$type<{
    plan?: string[];
    status?: string[];
    customFilter?: Record<string, any>;
  }>(),
  status: mysqlEnum("status", ["draft", "scheduled", "sending", "sent", "failed"]).default("draft").notNull(),
  scheduledAt: timestamp("scheduled_at"),
  sentAt: timestamp("sent_at"),
  totalRecipients: int("total_recipients").default(0).notNull(),
  successfulSends: int("successful_sends").default(0).notNull(),
  failedSends: int("failed_sends").default(0).notNull(),
  createdBy: int("created_by").notNull().references(() => adminUsers.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export const campaignRecipients = mysqlTable("campaign_recipients", {
  id: int("id").autoincrement().primaryKey(),
  campaignId: int("campaign_id").notNull().references(() => notificationCampaigns.id, { onDelete: "cascade" }),
  userEmail: varchar("user_email", { length: 255 }).notNull(),
  userId: varchar("user_id", { length: 100 }),
  status: mysqlEnum("status", ["pending", "sent", "failed", "bounced"]).default("pending").notNull(),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ================================================
// USER FEEDBACK SYSTEM
// ================================================

export const userFeedback = mysqlTable("user_feedback", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: int("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  userEmail: varchar("user_email", { length: 255 }),
  userId: varchar("user_id", { length: 100 }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  category: varchar("category", { length: 100 }),
  priority: mysqlEnum("priority", ["low", "medium", "high", "critical"]).default("medium").notNull(),
  status: mysqlEnum("status", ["pending", "reviewing", "planned", "in_progress", "completed", "rejected"]).default("pending").notNull(),
  votes: int("votes").default(0).notNull(),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

// ================================================
// SYSTEM MONITORING
// ================================================

export const errorLogs = mysqlTable("error_logs", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: int("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  errorType: varchar("error_type", { length: 100 }).notNull(),
  errorMessage: text("error_message").notNull(),
  stackTrace: text("stack_trace"),
  userId: varchar("user_id", { length: 100 }),
  requestUrl: text("request_url"),
  requestMethod: varchar("request_method", { length: 10 }),
  severity: mysqlEnum("severity", ["info", "warning", "error", "critical"]).default("error").notNull(),
  resolved: boolean("resolved").default(false).notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: int("resolved_by").references(() => adminUsers.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const healthChecks = mysqlTable("health_checks", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: int("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  checkType: varchar("check_type", { length: 100 }).notNull(),
  status: mysqlEnum("status", ["healthy", "degraded", "down"]).notNull(),
  responseTimeMs: int("response_time_ms"),
  errorMessage: text("error_message"),
  checkedAt: timestamp("checked_at").defaultNow().notNull(),
});

// ================================================
// ADMIN ACTIVITY LOG
// ================================================

export const adminActivityLog = mysqlTable("admin_activity_log", {
  id: int("id").autoincrement().primaryKey(),
  adminUserId: int("admin_user_id").references(() => adminUsers.id, { onDelete: "set null" }),
  action: varchar("action", { length: 255 }).notNull(),
  resourceType: varchar("resource_type", { length: 100 }),
  resourceId: varchar("resource_id", { length: 100 }),
  details: json("details").$type<Record<string, any>>(),
  ipAddress: varchar("ip_address", { length: 45 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ================================================
// STRIPE INTEGRATION CACHE
// ================================================

export const stripeCustomersCache = mysqlTable("stripe_customers_cache", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: int("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  stripeCustomerId: varchar("stripe_customer_id", { length: 255 }).notNull().unique(),
  userId: varchar("user_id", { length: 100 }),
  email: varchar("email", { length: 255 }),
  name: varchar("name", { length: 255 }),
  subscriptionStatus: varchar("subscription_status", { length: 50 }),
  planName: varchar("plan_name", { length: 100 }),
  currentPeriodEnd: timestamp("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
  lastSyncedAt: timestamp("last_synced_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ================================================
// ANALYTICS SNAPSHOTS
// ================================================

export const dailyMetrics = mysqlTable("daily_metrics", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: int("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  metricDate: timestamp("metric_date").notNull(),
  totalUsers: int("total_users").default(0).notNull(),
  activeUsers: int("active_users").default(0).notNull(),
  newUsers: int("new_users").default(0).notNull(),
  churnedUsers: int("churned_users").default(0).notNull(),
  totalRevenue: decimal("total_revenue", { precision: 10, scale: 2 }).default("0.00").notNull(),
  mrr: decimal("mrr", { precision: 10, scale: 2 }).default("0.00").notNull(),
  usersByPlan: json("users_by_plan").$type<Record<string, number>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ================================================
// IN-APP PUSH NOTIFICATIONS
// ================================================

export const inAppNotifications = mysqlTable("in_app_notifications", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: int("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 100 }), // Null = broadcast to all
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  priority: mysqlEnum("priority", ["info", "warning", "important", "critical"]).default("info").notNull(),
  category: varchar("category", { length: 50 }), // 'payment', 'contract', 'user', 'system', 'lead', etc.
  actionUrl: text("action_url"),
  actionLabel: varchar("action_label", { length: 50 }),
  icon: varchar("icon", { length: 50 }),
  read: boolean("read").default(false).notNull(),
  readAt: timestamp("read_at"),
  archived: boolean("archived").default(false).notNull(),
  expiresAt: timestamp("expires_at"),
  metadata: json("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userUnreadIdx: index("idx_user_unread").on(table.userId, table.read, table.createdAt),
  appPriorityIdx: index("idx_app_priority").on(table.applicationId, table.priority, table.createdAt),
}));

export const notificationPreferences = mysqlTable("notification_preferences", {
  id: int("id").autoincrement().primaryKey(),
  userId: varchar("user_id", { length: 100 }).notNull().unique(),
  applicationId: int("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").default(true).notNull(),
  minPriority: mysqlEnum("min_priority", ["info", "warning", "important", "critical"]).default("info"),
  categoriesEnabled: json("categories_enabled").$type<string[]>(),
  quietHoursStart: time("quiet_hours_start"),
  quietHoursEnd: time("quiet_hours_end"),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

// ================================================
// TYPE EXPORTS
// ================================================

export type AdminUser = typeof adminUsers.$inferSelect;
export type InsertAdminUser = typeof adminUsers.$inferInsert;

export type OtpCode = typeof otpCodes.$inferSelect;
export type InsertOtpCode = typeof otpCodes.$inferInsert;

export type AdminSession = typeof adminSessions.$inferSelect;
export type InsertAdminSession = typeof adminSessions.$inferInsert;

export type Application = typeof applications.$inferSelect;
export type InsertApplication = typeof applications.$inferInsert;

export type NotificationCampaign = typeof notificationCampaigns.$inferSelect;
export type InsertNotificationCampaign = typeof notificationCampaigns.$inferInsert;

export type CampaignRecipient = typeof campaignRecipients.$inferSelect;
export type InsertCampaignRecipient = typeof campaignRecipients.$inferInsert;

export type UserFeedback = typeof userFeedback.$inferSelect;
export type InsertUserFeedback = typeof userFeedback.$inferInsert;

export type ErrorLog = typeof errorLogs.$inferSelect;
export type InsertErrorLog = typeof errorLogs.$inferInsert;

export type HealthCheck = typeof healthChecks.$inferSelect;
export type InsertHealthCheck = typeof healthChecks.$inferInsert;

export type AdminActivityLog = typeof adminActivityLog.$inferSelect;
export type InsertAdminActivityLog = typeof adminActivityLog.$inferInsert;

export type StripeCustomerCache = typeof stripeCustomersCache.$inferSelect;
export type InsertStripeCustomerCache = typeof stripeCustomersCache.$inferInsert;

export type DailyMetric = typeof dailyMetrics.$inferSelect;
export type InsertDailyMetric = typeof dailyMetrics.$inferInsert;

export type InAppNotification = typeof inAppNotifications.$inferSelect;
export type InsertInAppNotification = typeof inAppNotifications.$inferInsert;

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type InsertNotificationPreference = typeof notificationPreferences.$inferInsert;

// Legacy exports for compatibility with auth system
export const users = adminUsers;
export type User = AdminUser;
export type InsertUser = InsertAdminUser;
