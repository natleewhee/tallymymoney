-- Users
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    telegram_chat_id BIGINT UNIQUE NOT NULL,
    email_address VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Transactions
CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    amount DECIMAL(10,2) NOT NULL,
    merchant VARCHAR(255),
    description TEXT,
    category VARCHAR(50),
    transaction_type VARCHAR(20), -- 'expense' or 'income'
    expense_type VARCHAR(20), -- 'solo', 'joint', 'ignored'
    transaction_date TIMESTAMP,
    email_message_id VARCHAR(255) UNIQUE,
    matched_transaction_id INT REFERENCES transactions(id),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Categories
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE,
    emoji VARCHAR(10)
);