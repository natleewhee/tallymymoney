-- Users table (for multi-user support if needed)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    telegram_chat_id BIGINT UNIQUE,
    username VARCHAR(255),
    email_address VARCHAR(255),
    email_provider VARCHAR(50),
    email_credentials_encrypted TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE
);

-- Transactions table
CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    email_message_id VARCHAR(255) UNIQUE,
    amount DECIMAL(10,2) NOT NULL,
    description TEXT,
    merchant VARCHAR(255),
    category VARCHAR(50),
    transaction_type VARCHAR(20) CHECK (transaction_type IN ('expense', 'income')),
    expense_type VARCHAR(20) CHECK (expense_type IN ('solo', 'joint', 'ignored', 'pending')),
    transaction_date TIMESTAMP NOT NULL,
    matched_transaction_id INT REFERENCES transactions(id),
    notification_message_id BIGINT, -- Telegram message ID
    status VARCHAR(20) DEFAULT 'pending',
    archived_to_sheets BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP,
    archived_at TIMESTAMP
);

-- Categories table
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE,
    emoji VARCHAR(10),
    is_default BOOLEAN DEFAULT TRUE
);

-- Monthly summaries table
CREATE TABLE monthly_summaries (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    month DATE,
    total_expense DECIMAL(10,2),
    solo_expense DECIMAL(10,2),
    joint_expense DECIMAL(10,2),
    category_breakdown JSONB,
    transaction_count INT,
    report_sent BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_transactions_date ON transactions(transaction_date);
CREATE INDEX idx_transactions_user_date ON transactions(user_id, transaction_date);
CREATE INDEX idx_transactions_status ON transactions(status);