
### Render Services Setup

#### 1. Web Service (Telegram Bot)
- **Type**: Web Service
- **Runtime**: Python 3.11
- **Plan**: Starter ($7/month) or Free (with cold starts)
- **Purpose**: 
  - Handle Telegram webhooks
  - Process user interactions
  - Run on 24/7

#### 2. Worker Service (Email Scanner)
- **Type**: Background Worker
- **Runtime**: Python 3.11
- **Plan**: Starter ($7/month) or Free
- **Purpose**:
  - Poll emails every 5 minutes
  - Parse transactions
  - Queue notifications
  - Run on 24/7

#### 3. Cron Job (Monthly Reports)
- **Type**: Cron Job
- **Schedule**: `0 9 1 * *` (9 AM on 1st of every month)
- **Purpose**:
  - Generate text summaries
  - Send via Telegram
  - Archive monthly data

#### 4. PostgreSQL Database
- **Type**: PostgreSQL
- **Plan**: Free tier (1GB) or Starter ($7/month)
- **Purpose**: Store all transactions and user data

### Deployment Configuration (render.yaml)

```yaml
services:
  # Telegram Bot Web Service
  - type: web
    name: expense-bot-web
    env: python
    region: singapore  # or your preferred region
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn app:app --host 0.0.0.0 --port $PORT
    plan: starter
    envVars:
      - key: TELEGRAM_BOT_TOKEN
        sync: false
      - key: DATABASE_URL
        fromDatabase:
          name: expense-db
          property: connectionString
      - key: WEBHOOK_URL
        value: https://expense-bot-web.onrender.com
      - key: GOOGLE_SHEETS_ID
        sync: false
      - key: GMAIL_APP_PASSWORD
        sync: false
      - key: GMAIL_USERNAME
        sync: false
      - key: TELEGRAM_CHAT_ID
        sync: false
      - key: ENVIRONMENT
        value: production

  # Email Scanner Worker
  - type: worker
    name: email-scanner-worker
    env: python
    region: singapore
    buildCommand: pip install -r requirements.txt
    startCommand: python -m services.email_scanner
    plan: starter
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: expense-db
          property: connectionString
      - key: GMAIL_APP_PASSWORD
        sync: false
      - key: GMAIL_USERNAME
        sync: false
      - key: TELEGRAM_BOT_TOKEN
        sync: false
      - key: TELEGRAM_CHAT_ID
        sync: false
      - key: SCAN_INTERVAL_MINUTES
        value: "5"
      - key: ENVIRONMENT
        value: production

  # Monthly Report Cron Job
  - type: cron
    name: monthly-report-generator
    env: python
    region: singapore
    schedule: "0 9 1 * *"
    buildCommand: pip install -r requirements.txt
    startCommand: python -m services.report_generator
    plan: starter
    envVars:
      - key: DATABASE_URL
        fromDatabase:
          name: expense-db
          property: connectionString
      - key: TELEGRAM_BOT_TOKEN
        sync: false
      - key: TELEGRAM_CHAT_ID
        sync: false
      - key: GOOGLE_SHEETS_ID
        sync: false
      - key: ENVIRONMENT
        value: production

databases:
  - name: expense-db
    plan: free
    region: singapore