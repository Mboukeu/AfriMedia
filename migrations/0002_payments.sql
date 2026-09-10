ALTER TABLE orders ADD COLUMN payment_transaction_id TEXT;
ALTER TABLE orders ADD COLUMN payment_url TEXT;
ALTER TABLE orders ADD COLUMN payment_method TEXT;
ALTER TABLE orders ADD COLUMN paid_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_payment_transaction ON orders(payment_transaction_id);
