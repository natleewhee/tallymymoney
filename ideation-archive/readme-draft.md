# 💳 Telegram Expense Tracker Bot

An intelligent expense tracking system that automatically monitors your emails for financial transactions and helps you categorize them through Telegram. Built for individuals who want automated expense tracking without manual data entry.

## 🎯 What This Bot Does

1. **📧 Auto-detects transactions** from your email (bank/credit card notifications)
2. **📱 Notifies you via Telegram** with interactive buttons for categorization
3. **👥 Tracks joint vs solo expenses** for splitting with friends/partners
4. **💰 Matches incoming payments** with previous expenses
5. **📊 Generates monthly text reports** with category breakdowns
6. **📦 Archives everything** to Google Sheets for record-keeping

## 🚀 Quick Start

### Prerequisites
- Python 3.11+
- A Telegram account
- A Gmail account (with App Password enabled)
- GitHub account (for deployment)
- Render account (for hosting)

### Local Development Setup

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/expense-tracker-bot.git
cd expense-tracker-bot

# 2. Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Copy environment variables template
cp .env.example .env

# 5. Fill in your credentials in .env file
# - TELEGRAM_BOT_TOKEN (from @BotFather)
# - TELEGRAM_CHAT_ID (your chat ID)
# - GMAIL_USERNAME (your email)
# - GMAIL_APP_PASSWORD (Gmail App Password)
# - GOOGLE_SHEETS_ID (for archiving)
# - DATABASE_URL (PostgreSQL connection string)

# 6. Run the bot locally
python app.py