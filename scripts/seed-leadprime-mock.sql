-- Mock of the LeadPrime tables the commission engine READS (production
-- names/columns). For the E2E validation script ONLY — never production.
-- Usage:  psql "$E2E_LEADPRIME_DB_URL" -f scripts/seed-leadprime-mock.sql
CREATE TABLE IF NOT EXISTS contractors (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255), email VARCHAR(255), phone VARCHAR(50),
  company_name VARCHAR(255), created_at TIMESTAMP DEFAULT now(),
  referral_code VARCHAR(50)
);
CREATE TABLE IF NOT EXISTS company_profiles (
  id VARCHAR(50) PRIMARY KEY DEFAULT gen_random_uuid()::varchar(50),
  contractor_id VARCHAR(100) UNIQUE, business_name VARCHAR(255)
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY, contractor_id VARCHAR(100), status VARCHAR(50),
  plan VARCHAR(100), plan_name VARCHAR(100), base_price_cents INT,
  created_at TIMESTAMP DEFAULT now(), canceled_at TIMESTAMP
);
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY, contractor_id VARCHAR(100), stripe_invoice_id VARCHAR(100),
  amount_due INT, amount_paid INT, status VARCHAR(50),
  paid_at TIMESTAMP, created_at TIMESTAMP DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id BIGSERIAL PRIMARY KEY, contractor_id VARCHAR(100), amount_cents INT,
  type VARCHAR(50), description TEXT, metadata JSONB, created_at TIMESTAMP DEFAULT now()
);

INSERT INTO contractors (id, name, email, company_name, created_at, referral_code) VALUES
 ('ctr_ref_pays',   'Juan Pérez', 'juan@rooferspro.com',   'Roofers Pro LLC', '2026-06-01', 'PRIME'),
 ('ctr_ref_nopay',  'Ana López',  'ana@paintco.com',       'PaintCo',         '2026-07-01', 'PRIME'),
 ('ctr_organic',    'Luis Gómez', 'luis@organicbuild.com', 'Organic Build',   '2026-06-15', NULL),
 ('ctr_ref_year2',  'Mia Torres', 'mia@oldclient.com',     'Old Client Inc',  '2025-05-01', 'PRIME'),
 ('ctr_ref_cancel', 'Leo Ruiz',   'leo@cancelled.com',     'Cancelled Co',    '2026-06-20', 'PRIME')
ON CONFLICT (id) DO NOTHING;
INSERT INTO company_profiles (contractor_id, business_name) VALUES
 ('ctr_ref_pays','Roofers Pro LLC'),('ctr_ref_nopay','PaintCo'),('ctr_organic','Organic Build'),
 ('ctr_ref_year2','Old Client Inc'),('ctr_ref_cancel','Cancelled Co')
ON CONFLICT (contractor_id) DO NOTHING;
INSERT INTO subscriptions (contractor_id, status, plan_name, base_price_cents) VALUES
 ('ctr_ref_pays','active','network_elite',15000),
 ('ctr_organic','active','network_elite',15000),
 ('ctr_ref_year2','active','chyrris_growth',50000);
INSERT INTO subscriptions (contractor_id, status, plan_name, base_price_cents, canceled_at) VALUES
 ('ctr_ref_cancel','canceled','network_elite',15000,'2026-07-10');
INSERT INTO invoices (contractor_id, stripe_invoice_id, amount_due, amount_paid, status, paid_at, created_at) VALUES
 ('ctr_ref_pays','in_test_001',15000,15000,'paid','2026-06-05','2026-06-05'),
 ('ctr_ref_pays','in_test_002',15000,15000,'paid','2026-07-05','2026-07-05'),
 ('ctr_organic','in_test_003',15000,15000,'paid','2026-07-06','2026-07-06'),
 ('ctr_ref_year2','in_test_010',50000,50000,'paid','2025-05-10','2025-05-10'),
 ('ctr_ref_year2','in_test_011',50000,50000,'paid','2026-07-01','2026-07-01'),
 ('ctr_ref_cancel','in_test_020',15000,15000,'paid','2026-06-25','2026-06-25');
INSERT INTO wallet_transactions (contractor_id, amount_cents, type, description, created_at) VALUES
 ('ctr_ref_pays',5000,'stripe_purchase','Wallet top-up','2026-07-10'),
 ('ctr_ref_pays',2000,'subscription_recharge','Included credits','2026-07-05');
