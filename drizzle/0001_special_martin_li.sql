-- Custom SQL migration file, put your code below! --

-- Drop old users table if exists
DROP TABLE IF EXISTS `users`;

-- Create admin_users table
CREATE TABLE `admin_users` (
  `id` int AUTO_INCREMENT NOT NULL,
  `email` varchar(255) NOT NULL,
  `name` varchar(255),
  `role` enum('super_admin','admin','viewer') NOT NULL DEFAULT 'admin',
  `is_active` boolean NOT NULL DEFAULT true,
  `last_login_at` timestamp,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `admin_users_id` PRIMARY KEY(`id`),
  CONSTRAINT `admin_users_email_unique` UNIQUE(`email`)
);

-- Create otp_codes table
CREATE TABLE `otp_codes` (
  `id` int AUTO_INCREMENT NOT NULL,
  `email` varchar(255) NOT NULL,
  `code` varchar(6) NOT NULL,
  `expires_at` timestamp NOT NULL,
  `used` boolean NOT NULL DEFAULT false,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `otp_codes_id` PRIMARY KEY(`id`)
);

-- Create admin_sessions table
CREATE TABLE `admin_sessions` (
  `id` varchar(255) NOT NULL,
  `admin_user_id` int NOT NULL,
  `ip_address` varchar(45),
  `user_agent` text,
  `expires_at` timestamp NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `admin_sessions_id` PRIMARY KEY(`id`)
);

-- Create applications table
CREATE TABLE `applications` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(100) NOT NULL,
  `slug` varchar(50) NOT NULL,
  `description` text,
  `database_url` text NOT NULL,
  `database_type` varchar(50) NOT NULL DEFAULT 'postgresql',
  `status` enum('active','inactive','maintenance') NOT NULL DEFAULT 'active',
  `icon_url` text,
  `color` varchar(7),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `applications_id` PRIMARY KEY(`id`),
  CONSTRAINT `applications_slug_unique` UNIQUE(`slug`)
);

-- Create notification_campaigns table
CREATE TABLE `notification_campaigns` (
  `id` int AUTO_INCREMENT NOT NULL,
  `application_id` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `subject` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `target_segment` json,
  `status` enum('draft','scheduled','sending','sent','failed') NOT NULL DEFAULT 'draft',
  `scheduled_at` timestamp,
  `sent_at` timestamp,
  `total_recipients` int NOT NULL DEFAULT 0,
  `successful_sends` int NOT NULL DEFAULT 0,
  `failed_sends` int NOT NULL DEFAULT 0,
  `created_by` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `notification_campaigns_id` PRIMARY KEY(`id`)
);

-- Create campaign_recipients table
CREATE TABLE `campaign_recipients` (
  `id` int AUTO_INCREMENT NOT NULL,
  `campaign_id` int NOT NULL,
  `user_email` varchar(255) NOT NULL,
  `user_id` varchar(100),
  `status` enum('pending','sent','failed','bounced') NOT NULL DEFAULT 'pending',
  `error_message` text,
  `sent_at` timestamp,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `campaign_recipients_id` PRIMARY KEY(`id`)
);

-- Create user_feedback table
CREATE TABLE `user_feedback` (
  `id` int AUTO_INCREMENT NOT NULL,
  `application_id` int NOT NULL,
  `user_email` varchar(255),
  `user_id` varchar(100),
  `title` varchar(255) NOT NULL,
  `description` text NOT NULL,
  `category` varchar(100),
  `priority` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `status` enum('pending','reviewing','planned','in_progress','completed','rejected') NOT NULL DEFAULT 'pending',
  `votes` int NOT NULL DEFAULT 0,
  `admin_notes` text,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `user_feedback_id` PRIMARY KEY(`id`)
);

-- Create error_logs table
CREATE TABLE `error_logs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `application_id` int NOT NULL,
  `error_type` varchar(100) NOT NULL,
  `error_message` text NOT NULL,
  `stack_trace` text,
  `user_id` varchar(100),
  `request_url` text,
  `request_method` varchar(10),
  `severity` enum('info','warning','error','critical') NOT NULL DEFAULT 'error',
  `resolved` boolean NOT NULL DEFAULT false,
  `resolved_at` timestamp,
  `resolved_by` int,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `error_logs_id` PRIMARY KEY(`id`)
);

-- Create health_checks table
CREATE TABLE `health_checks` (
  `id` int AUTO_INCREMENT NOT NULL,
  `application_id` int NOT NULL,
  `check_type` varchar(100) NOT NULL,
  `status` enum('healthy','degraded','down') NOT NULL,
  `response_time_ms` int,
  `error_message` text,
  `checked_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `health_checks_id` PRIMARY KEY(`id`)
);

-- Create admin_activity_log table
CREATE TABLE `admin_activity_log` (
  `id` int AUTO_INCREMENT NOT NULL,
  `admin_user_id` int,
  `action` varchar(255) NOT NULL,
  `resource_type` varchar(100),
  `resource_id` varchar(100),
  `details` json,
  `ip_address` varchar(45),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `admin_activity_log_id` PRIMARY KEY(`id`)
);

-- Create stripe_customers_cache table
CREATE TABLE `stripe_customers_cache` (
  `id` int AUTO_INCREMENT NOT NULL,
  `application_id` int NOT NULL,
  `stripe_customer_id` varchar(255) NOT NULL,
  `user_id` varchar(100),
  `email` varchar(255),
  `name` varchar(255),
  `subscription_status` varchar(50),
  `plan_name` varchar(100),
  `current_period_end` timestamp,
  `cancel_at_period_end` boolean NOT NULL DEFAULT false,
  `last_synced_at` timestamp NOT NULL DEFAULT (now()),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `stripe_customers_cache_id` PRIMARY KEY(`id`),
  CONSTRAINT `stripe_customers_cache_stripe_customer_id_unique` UNIQUE(`stripe_customer_id`)
);

-- Create daily_metrics table
CREATE TABLE `daily_metrics` (
  `id` int AUTO_INCREMENT NOT NULL,
  `application_id` int NOT NULL,
  `metric_date` timestamp NOT NULL,
  `total_users` int NOT NULL DEFAULT 0,
  `active_users` int NOT NULL DEFAULT 0,
  `new_users` int NOT NULL DEFAULT 0,
  `churned_users` int NOT NULL DEFAULT 0,
  `total_revenue` decimal(10,2) NOT NULL DEFAULT '0.00',
  `mrr` decimal(10,2) NOT NULL DEFAULT '0.00',
  `users_by_plan` json,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `daily_metrics_id` PRIMARY KEY(`id`)
);

-- Add foreign keys
ALTER TABLE `admin_sessions` ADD CONSTRAINT `admin_sessions_admin_user_id_admin_users_id_fk` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `notification_campaigns` ADD CONSTRAINT `notification_campaigns_application_id_applications_id_fk` FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `notification_campaigns` ADD CONSTRAINT `notification_campaigns_created_by_admin_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `admin_users`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `campaign_recipients` ADD CONSTRAINT `campaign_recipients_campaign_id_notification_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `notification_campaigns`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `user_feedback` ADD CONSTRAINT `user_feedback_application_id_applications_id_fk` FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `error_logs` ADD CONSTRAINT `error_logs_application_id_applications_id_fk` FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `error_logs` ADD CONSTRAINT `error_logs_resolved_by_admin_users_id_fk` FOREIGN KEY (`resolved_by`) REFERENCES `admin_users`(`id`) ON DELETE no action ON UPDATE no action;
ALTER TABLE `health_checks` ADD CONSTRAINT `health_checks_application_id_applications_id_fk` FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `admin_activity_log` ADD CONSTRAINT `admin_activity_log_admin_user_id_admin_users_id_fk` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_users`(`id`) ON DELETE set null ON UPDATE no action;
ALTER TABLE `stripe_customers_cache` ADD CONSTRAINT `stripe_customers_cache_application_id_applications_id_fk` FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON DELETE cascade ON UPDATE no action;
ALTER TABLE `daily_metrics` ADD CONSTRAINT `daily_metrics_application_id_applications_id_fk` FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON DELETE cascade ON UPDATE no action;

-- Insert default applications
INSERT INTO `applications` (`name`, `slug`, `description`, `database_url`, `color`) VALUES
('Owl Fenc', 'owlfenc', 'AI-Powered Construction Management Platform', 'postgresql://neondb_owner:npg_ZT0PokJOevI4@ep-patient-pond-a4sbimqt.us-east-1.aws.neon.tech/neondb?sslmode=require', '#6366f1'),
('LeadPrime', 'leadprime', 'Mini CRM for Construction Contractors', 'postgresql://neondb_owner:npg_O1XRz3cblmEG@ep-steep-breeze-afkoir6b-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require', '#10b981');