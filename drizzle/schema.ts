import { integer, pgEnum, pgTable, text, timestamp, varchar, decimal, boolean, json, index, uniqueIndex, time } from "drizzle-orm/pg-core";
import { serial } from "drizzle-orm/pg-core";

/**
 * CHYRRIS KAI - Multi-Application Admin Control Platform
 * Database Schema for managing Owl Fenc, LeadPrime, and future applications
 */

// ================================================
// ENUMS
// ================================================

export const roleEnum = pgEnum("role", ["super_admin", "admin", "viewer"]);
export const referralPartnerStatusEnum = pgEnum("referral_partner_status", ["invited", "active", "paused", "inactive"]);
// Document types.
//  - Informational (admin-uploaded, no signature): revenue_projection, features,
//    term_sheet_info — shown in the partner's "Materiales de LeadPrime".
//  - report (admin-uploaded, free title): recurring deliverables like quarterly
//    referral reports — shown in the partner's "Reportes" section.
//  - Signed by the partner via LeadSign: term_sheet_signed, contract,
//    ach_authorization, w9. 'other' is a catch-all.
export const partnerDocTypeEnum = pgEnum("partner_doc_type", [
  "contract",
  "w9",
  "ach_authorization",
  "other",
  "revenue_projection",
  "features",
  "term_sheet_info",
  "term_sheet_signed",
  "report",
]);
export const partnerDocStatusEnum = pgEnum("partner_doc_status", ["pending", "uploaded", "verified"]);
export const attributionStatusEnum = pgEnum("attribution_status", ["pending_first_payment", "active", "inactive"]);
export const commissionPayoutStatusEnum = pgEnum("commission_payout_status", ["pending", "paid"]);
export const payoutStatusEnum = pgEnum("payout_status", ["pending", "paid"]);
export const partnerInvitationStatusEnum = pgEnum("partner_invitation_status", [
  "pending_approval",
  "sent",
  "registered",
  "active",
  "declined",
]);
export const applicationStatusEnum = pgEnum("application_status", ["active", "inactive", "maintenance"]);
export const campaignStatusEnum = pgEnum("campaign_status", ["draft", "scheduled", "sending", "sent", "failed"]);
export const recipientStatusEnum = pgEnum("recipient_status", ["pending", "sent", "failed", "bounced"]);
export const priorityEnum = pgEnum("priority", ["low", "medium", "high", "critical"]);
export const feedbackStatusEnum = pgEnum("feedback_status", ["pending", "reviewing", "planned", "in_progress", "completed", "rejected"]);
export const severityEnum = pgEnum("severity", ["info", "warning", "error", "critical"]);
export const healthStatusEnum = pgEnum("health_status", ["healthy", "degraded", "down"]);
export const notificationPriorityEnum = pgEnum("notification_priority", ["info", "warning", "important", "critical"]);

// ================================================
// ADMIN USERS & AUTHENTICATION
// ================================================

export const adminUsers = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  role: roleEnum("role").default("admin").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const otpCodes = pgTable("otp_codes", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull(),
  code: varchar("code", { length: 6 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const adminSessions = pgTable("admin_sessions", {
  id: varchar("id", { length: 255 }).primaryKey(),
  adminUserId: integer("admin_user_id").notNull().references(() => adminUsers.id, { onDelete: "cascade" }),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ================================================
// APPLICATIONS REGISTRY
// ================================================

export const applications = pgTable("applications", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  description: text("description"),
  databaseUrl: text("database_url").notNull(),
  databaseType: varchar("database_type", { length: 50 }).default("postgresql").notNull(),
  status: applicationStatusEnum("status").default("active").notNull(),
  iconUrl: text("icon_url"),
  color: varchar("color", { length: 7 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ================================================
// NOTIFICATION CAMPAIGNS
// ================================================

export const notificationCampaigns = pgTable("notification_campaigns", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  message: text("message").notNull(),
  targetSegment: json("target_segment").$type<{
    plan?: string[];
    status?: string[];
    customFilter?: Record<string, any>;
  }>(),
  status: campaignStatusEnum("status").default("draft").notNull(),
  scheduledAt: timestamp("scheduled_at"),
  sentAt: timestamp("sent_at"),
  totalRecipients: integer("total_recipients").default(0).notNull(),
  successfulSends: integer("successful_sends").default(0).notNull(),
  failedSends: integer("failed_sends").default(0).notNull(),
  createdBy: integer("created_by").notNull().references(() => adminUsers.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const campaignRecipients = pgTable("campaign_recipients", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => notificationCampaigns.id, { onDelete: "cascade" }),
  userEmail: varchar("user_email", { length: 255 }).notNull(),
  userId: varchar("user_id", { length: 100 }),
  status: recipientStatusEnum("status").default("pending").notNull(),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ================================================
// USER FEEDBACK SYSTEM
// ================================================

export const userFeedback = pgTable("user_feedback", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  userEmail: varchar("user_email", { length: 255 }),
  userId: varchar("user_id", { length: 100 }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  category: varchar("category", { length: 100 }),
  priority: priorityEnum("priority").default("medium").notNull(),
  status: feedbackStatusEnum("status").default("pending").notNull(),
  votes: integer("votes").default(0).notNull(),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ================================================
// SYSTEM MONITORING
// ================================================

export const errorLogs = pgTable("error_logs", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  errorType: varchar("error_type", { length: 100 }).notNull(),
  errorMessage: text("error_message").notNull(),
  stackTrace: text("stack_trace"),
  userId: varchar("user_id", { length: 100 }),
  requestUrl: text("request_url"),
  requestMethod: varchar("request_method", { length: 10 }),
  severity: severityEnum("severity").default("error").notNull(),
  resolved: boolean("resolved").default(false).notNull(),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: integer("resolved_by").references(() => adminUsers.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const healthChecks = pgTable("health_checks", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  checkType: varchar("check_type", { length: 100 }).notNull(),
  status: healthStatusEnum("status").notNull(),
  responseTimeMs: integer("response_time_ms"),
  errorMessage: text("error_message"),
  checkedAt: timestamp("checked_at").defaultNow().notNull(),
});

// ================================================
// ADMIN ACTIVITY LOG
// ================================================

export const adminActivityLog = pgTable("admin_activity_log", {
  id: serial("id").primaryKey(),
  adminUserId: integer("admin_user_id").references(() => adminUsers.id, { onDelete: "set null" }),
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

export const stripeCustomersCache = pgTable("stripe_customers_cache", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
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

export const dailyMetrics = pgTable("daily_metrics", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  metricDate: timestamp("metric_date").notNull(),
  totalUsers: integer("total_users").default(0).notNull(),
  activeUsers: integer("active_users").default(0).notNull(),
  newUsers: integer("new_users").default(0).notNull(),
  churnedUsers: integer("churned_users").default(0).notNull(),
  totalRevenue: decimal("total_revenue", { precision: 10, scale: 2 }).default("0.00").notNull(),
  mrr: decimal("mrr", { precision: 10, scale: 2 }).default("0.00").notNull(),
  usersByPlan: json("users_by_plan").$type<Record<string, number>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ================================================
// IN-APP PUSH NOTIFICATIONS
// ================================================

export const inAppNotifications = pgTable("in_app_notifications", {
  id: serial("id").primaryKey(),
  applicationId: integer("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 100 }), // Null = broadcast to all
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  priority: notificationPriorityEnum("priority").default("info").notNull(),
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

export const notificationPreferences = pgTable("notification_preferences", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 100 }).notNull().unique(),
  applicationId: integer("application_id").notNull().references(() => applications.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").default(true).notNull(),
  minPriority: notificationPriorityEnum("min_priority").default("info"),
  categoriesEnabled: json("categories_enabled").$type<string[]>(),
  quietHoursStart: time("quiet_hours_start"),
  quietHoursEnd: time("quiet_hours_end"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ================================================
// PARTNER REFERRAL PORTAL (partners.chyrris.com)
// Multi-tenant referral program: each partner refers
// contractors to LeadPrime and earns recurring commission
// on collected revenue. Prime Contractors License Institute
// is the first partner; the model is fully generic.
// ================================================

export const referralPartners = pgTable("referral_partners", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  referralCode: varchar("referral_code", { length: 50 }).notNull().unique(),
  contactName: varchar("contact_name", { length: 255 }),
  contactEmail: varchar("contact_email", { length: 255 }).notNull().unique(),
  contactPhone: varchar("contact_phone", { length: 50 }),
  status: referralPartnerStatusEnum("status").default("invited").notNull(),
  tierYear1Pct: decimal("tier_year1_pct", { precision: 5, scale: 2 }).default("20.00").notNull(),
  tierYear2Pct: decimal("tier_year2_pct", { precision: 5, scale: 2 }).default("10.00").notNull(),
  freeAccountThreshold: integer("free_account_threshold").default(10).notNull(),
  onboardingComplete: boolean("onboarding_complete").default(false).notNull(),
  contactConfirmedAt: timestamp("contact_confirmed_at"),
  // Stage 1 of the onboarding journey: internal record that the partner
  // reviewed the informational materials. NOT a legal signature.
  materialsReviewedAt: timestamp("materials_reviewed_at"),
  // Set when the "onboarding complete" welcome email is sent. Doubles as the
  // once-ever lock: the send is claimed with a guarded UPDATE on this column,
  // so re-completing the journey never re-sends it.
  welcomeEmailSentAt: timestamp("welcome_email_sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const partnerDocuments = pgTable("partner_documents", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => referralPartners.id, { onDelete: "cascade" }),
  docType: partnerDocTypeEnum("doc_type").notNull(),
  // Admin-given display title (e.g. "Reporte Q3 2026 de referidos"). Used for
  // 'report' docs; null for the rest (they display by type label).
  title: varchar("title", { length: 255 }),
  fileUrl: text("file_url"),
  fileName: varchar("file_name", { length: 255 }),
  status: partnerDocStatusEnum("status").default("pending").notNull(),
  // Who uploaded it: 'admin' (LeadPrime informational docs + reports) or
  // 'partner' (signed docs). Drives the split in the Documentación section.
  uploadedBy: varchar("uploaded_by", { length: 20 }).default("partner").notNull(),
  uploadedAt: timestamp("uploaded_at"),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  partnerDocIdx: index("idx_partner_documents_partner").on(table.partnerId, table.docType),
}));

// referred_user_id is the LeadPrime contractors.id (VARCHAR). It lives in the
// LeadPrime database (separate Neon instance), so a SQL-level FK is impossible;
// integrity is enforced by the attribution flow + UNIQUE constraint.
export const referralAttributions = pgTable("referral_attributions", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => referralPartners.id, { onDelete: "cascade" }),
  referredUserId: varchar("referred_user_id", { length: 100 }).notNull().unique(),
  referralCode: varchar("referral_code", { length: 50 }).notNull(),
  signupDate: timestamp("signup_date").notNull(),
  firstPaymentDate: timestamp("first_payment_date"),
  status: attributionStatusEnum("status").default("pending_first_payment").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  attributionPartnerIdx: index("idx_referral_attributions_partner").on(table.partnerId, table.status),
}));

// One row per real collected charge. source_payment_id references the payment
// in the existing payment system (LeadPrime invoices / Stripe invoice id).
// Refunds/chargebacks are compensated with a negative row (is_reversal=true)
// so the ledger stays append-only; UNIQUE(source_payment_id, is_reversal)
// makes the sync engine idempotent for both charge and reversal.
export const referralCommissions = pgTable("referral_commissions", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => referralPartners.id, { onDelete: "cascade" }),
  attributionId: integer("attribution_id").notNull().references(() => referralAttributions.id, { onDelete: "cascade" }),
  sourcePaymentId: varchar("source_payment_id", { length: 255 }).notNull(),
  chargeAmount: decimal("charge_amount", { precision: 10, scale: 2 }).notNull(),
  appliedPct: decimal("applied_pct", { precision: 5, scale: 2 }).notNull(),
  commissionAmount: decimal("commission_amount", { precision: 10, scale: 2 }).notNull(),
  chargeDate: timestamp("charge_date").notNull(),
  isReversal: boolean("is_reversal").default(false).notNull(),
  payoutStatus: commissionPayoutStatusEnum("payout_status").default("pending").notNull(),
  payoutId: integer("payout_id").references(() => referralPayouts.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  commissionSourceUnique: uniqueIndex("uq_referral_commissions_source").on(table.sourcePaymentId, table.isReversal),
  commissionPartnerIdx: index("idx_referral_commissions_partner").on(table.partnerId, table.payoutStatus, table.chargeDate),
}));

export const referralPayouts = pgTable("referral_payouts", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => referralPartners.id, { onDelete: "cascade" }),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  totalAmount: decimal("total_amount", { precision: 10, scale: 2 }).notNull(),
  status: payoutStatusEnum("status").default("pending").notNull(),
  paidAt: timestamp("paid_at"),
  method: varchar("method", { length: 100 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// OTP codes for partner login. `code` stores a bcrypt hash, never the
// plaintext 6-digit code. attempts counts failed verifications (max 5).
export const partnerAuthCodes = pgTable("partner_auth_codes", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => referralPartners.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 100 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false).notNull(),
  attempts: integer("attempts").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  authCodePartnerIdx: index("idx_partner_auth_codes_partner").on(table.partnerId, table.createdAt),
}));

// Partner sessions are fully independent from admin_sessions: different table,
// different cookie. A partner session can never authorize admin procedures.
export const partnerSessions = pgTable("partner_sessions", {
  id: varchar("id", { length: 255 }).primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => referralPartners.id, { onDelete: "cascade" }),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Consent-based referral invitations sent by a partner to their graduates.
// The partner NEVER uploads third-party data in bulk — they enter one email,
// the graduate gets a personalized signup link carrying the partner's referral
// code, and attribution only happens when the graduate registers themselves.
// Status: pending_approval (admin approval mode) → sent → registered (graduate
// signed up) → active (first payment). token is used for the redirect link.
export const partnerInvitations = pgTable("partner_invitations", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => referralPartners.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  token: varchar("token", { length: 64 }).notNull().unique(),
  status: partnerInvitationStatusEnum("status").default("sent").notNull(),
  // The LeadPrime contractor id once the graduate registers (best-effort match
  // by email during the engine sync).
  registeredUserId: varchar("registered_user_id", { length: 100 }),
  sentAt: timestamp("sent_at"),
  registeredAt: timestamp("registered_at"),
  activatedAt: timestamp("activated_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  invitationPartnerIdx: index("idx_partner_invitations_partner").on(table.partnerId, table.status),
  invitationEmailIdx: index("idx_partner_invitations_email").on(table.email),
}));

// Simple key/value settings for the partner portal (LeadPrime landing/product
// links, invitation approval mode). Global, admin-editable.
export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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

export type ReferralPartner = typeof referralPartners.$inferSelect;
export type InsertReferralPartner = typeof referralPartners.$inferInsert;

export type PartnerDocument = typeof partnerDocuments.$inferSelect;
export type InsertPartnerDocument = typeof partnerDocuments.$inferInsert;

export type ReferralAttribution = typeof referralAttributions.$inferSelect;
export type InsertReferralAttribution = typeof referralAttributions.$inferInsert;

export type ReferralCommission = typeof referralCommissions.$inferSelect;
export type InsertReferralCommission = typeof referralCommissions.$inferInsert;

export type ReferralPayout = typeof referralPayouts.$inferSelect;
export type InsertReferralPayout = typeof referralPayouts.$inferInsert;

export type PartnerAuthCode = typeof partnerAuthCodes.$inferSelect;
export type InsertPartnerAuthCode = typeof partnerAuthCodes.$inferInsert;

export type PartnerSession = typeof partnerSessions.$inferSelect;
export type InsertPartnerSession = typeof partnerSessions.$inferInsert;

export type PartnerInvitation = typeof partnerInvitations.$inferSelect;
export type InsertPartnerInvitation = typeof partnerInvitations.$inferInsert;

export type AppSetting = typeof appSettings.$inferSelect;
export type InsertAppSetting = typeof appSettings.$inferInsert;

// Legacy exports for compatibility with auth system
export const users = adminUsers;
export type User = AdminUser;
export type InsertUser = InsertAdminUser;
