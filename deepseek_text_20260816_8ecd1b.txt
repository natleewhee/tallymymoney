
---

# PRD.md

```markdown
# Product Requirements Document (PRD)
## Telegram Expense Tracker Bot

**Version**: 1.0  
**Last Updated**: March 2024  
**Status**: In Development  
**Owner**: [Your Name]

---

## 1. Executive Summary

### 1.1 Problem Statement
Manual expense tracking is time-consuming and often forgotten. Existing solutions require manual data entry or expensive subscription fees. Users need an automated solution that integrates with their existing workflow (email + Telegram) to track expenses effortlessly.

### 1.2 Solution Overview
A Telegram bot that automatically:
- Scans emails for bank/credit card transaction notifications
- Sends interactive Telegram messages for categorization
- Tracks solo vs joint expenses
- Matches incoming payments with prior expenses
- Generates monthly text-based reports
- Archives all transactions to Google Sheets

### 1.3 Target Users
- **Primary**: Individuals who want automated expense tracking
- **Secondary**: People who split expenses with friends/roommates
- **Tertiary**: Freelancers tracking business vs personal expenses

### 1.4 Value Proposition
- **Zero manual entry**: Transactions automatically detected from emails
- **Real-time awareness**: Instant Telegram notifications
- **Simple categorization**: One-tap expense classification
- **Cost splitting**: Built-in joint expense tracking
- **Cloud-hosted**: No dependency on local computer
- **Affordable**: ~$14/month hosting cost

---

## 2. Goals and Objectives

### 2.1 Business Goals
| Goal | Metric | Target |
|------|--------|--------|
| Reduce manual tracking time | Hours saved/week | 2+ hours |
| Increase expense awareness | % transactions categorized | >90% |
| Improve cost splitting accuracy | Joint expense tracking accuracy | >95% |
| Ensure data persistence | Transaction retention | 100% |

### 2.2 Success Metrics
- **Activation**: User successfully configures email + bot within 15 minutes
- **Engagement**: >80% transactions categorized within 24 hours
- **Retention**: Continues using bot after 3 months
- **Satisfaction**: Monthly report usefulness rating >4/5

### 2.3 Non-Goals
- Not building a full accounting software
- Not supporting multiple currencies initially
- Not providing investment tracking
- Not building a mobile app (Telegram serves as UI)

---

## 3. User Personas

### 3.1 Primary Persona: "Busy Professional"
**Name**: Sarah, 28  
**Occupation**: Marketing Manager  
**Income**: $5,000/month  
**Pain Points**:
- Forgets to log expenses
- Struggles to track shared expenses with roommate
- Wants monthly spending insights

**Goals**:
- Automate expense tracking
- Split household expenses easily
- Understand spending patterns

### 3.2 Secondary Persona: "Student"
**Name**: John, 22  
**Occupation**: University Student  
**Income**: $1,500/month (part-time + allowance)  
**Pain Points**:
- Limited budget requires careful tracking
- Splits meals/transport with friends
- Needs to track expenses for part-time work

**Goals**:
- Track every dollar spent
- Easily split costs with friends
- Export data for budgeting

---

## 4. Functional Requirements

### 4.1 Email Integration

#### FR-1: Email Connection
- **Priority**: P0 (Critical)
- **Description**: Connect to Gmail via IMAP using App Password
- **Acceptance Criteria**:
  - Successfully connects to Gmail
  - Handles connection errors gracefully
  - Reconnects automatically after failures

#### FR-2: Transaction Detection
- **Priority**: P0 (Critical)
- **Description**: Parse emails to detect financial transactions
- **Acceptance Criteria**:
  - Identifies emails from supported banks (DBS, OCBC, UOB, Citibank)
  - Extracts amount, merchant, date, and transaction type
  - Handles multiple email formats
  - Ignores non-transaction emails (newsletters, statements)

#### FR-3: Email Polling
- **Priority**: P0 (Critical)
- **Description**: Poll inbox at regular intervals
- **Acceptance Criteria**:
  - Polls every 5 minutes (configurable)
  - Marks processed emails as read
  - Prevents duplicate processing
  - Runs continuously in background

### 4.2 Telegram Integration

#### FR-4: Transaction Notifications
- **Priority**: P0 (Critical)
- **Description**: Send Telegram message for each detected transaction
- **Acceptance Criteria**:
  - Message includes amount, merchant, date, description
  - Provides action buttons (Solo, Joint, Edit, Ignore)
  - Uses Markdown formatting for readability
  - Sent within 1 minute of detection

#### FR-5: Categorization Interface
- **Priority**: P0 (Critical)
- **Description**: Interactive buttons for expense categorization
- **Acceptance Criteria**:
  - One-tap Solo/Joint classification
  - Edit description option
  - Ignore option for non-expenses
  - Confirmation message after action

#### FR-6: Income Matching
- **Priority**: P1 (High)
- **Description**: Match incoming payments with prior expenses
- **Acceptance Criteria**:
  - Shows last 5 expenses when income detected
  - Allows selection of matching expense
  - Links transactions in database
  - Option to skip matching

### 4.3 Expense Management

#### FR-7: Solo Expense Tracking
- **Priority**: P0 (Critical)
- **Description**: Track individual expenses
- **Acceptance Criteria**:
  - Categorize as solo expense
  - Assign to category (Food, Transport, etc.)
  - Include in monthly report

#### FR-8: Joint Expense Tracking
- **Priority**: P0 (Critical)
- **Description**: Track shared expenses
- **Acceptance Criteria**:
  - Mark expense as joint
  - Track joint expense total separately
  - Include in monthly report with breakdown

#### FR-9: Income Matching
- **Priority**: P1 (High)
- **Description**: Match income with prior expenses
- **Acceptance Criteria**:
  - Detect incoming transactions
  - Show recent expenses for matching
  - Store matched relationship
  - Calculate net expense after matching

### 4.4 Reporting

#### FR-10: Monthly Report Generation
- **Priority**: P1 (High)
- **Description**: Generate monthly expense summary
- **Acceptance Criteria**:
  - Auto-generates on 1st of each month
  - Includes total, solo, and joint expenses
  - Category-wise breakdown
  - Sent via Telegram as text message
  - Stored in database for history

#### FR-11: On-Demand Reports
- **Priority**: P2 (Medium)
- **Description**: Generate reports on request
- **Acceptance Criteria**:
  - `/today` command shows today's expenses
  - `/week` shows weekly summary
  - `/month` shows current month
  - `/report` generates custom date range report

### 4.5 Data Management

#### FR-12: Transaction Archive
- **Priority**: P1 (High)
- **Description**: Archive all transactions to Google Sheets
- **Acceptance Criteria**:
  - Syncs to Google Sheets automatically
  - Creates new tab for each month
  - Includes all transaction details
  - Handles batch updates

#### FR-13: Data Export
- **Priority**: P2 (Medium)
- **Description**: Export transaction data
- **Acceptance Criteria**:
  - Export as CSV
  - Filter by date range
  - Include all fields
  - Send file via Telegram

---

## 5. Non-Functional Requirements

### 5.1 Performance
- **Response Time**: Telegram bot responds <2 seconds
- **Email Processing**: <5 minutes from email receipt to notification
- **Report Generation**: <30 seconds for monthly report
- **Database Queries**: <100ms for typical queries

### 5.2 Reliability
- **Uptime**: 99.9% (Render SLA)
- **Error Recovery**: Automatic retry on failures
- **Data Durability**: PostgreSQL with automatic backups
- **Crash Recovery**: Graceful restart without data loss

### 5.3 Security
- **Email Credentials**: Stored as environment variables
- **Telegram Token**: Not exposed in code
- **Database**: SSL encryption
- **Webhook**: Token validation
- **Google Sheets**: Service account with minimal permissions

### 5.4 Scalability
- **Transactions**: Support up to 10,000/month
- **Email Volume**: Handle 1,000+ emails/day
- **Concurrent Users**: Support 1 user initially, design for 10+

### 5.5 Maintainability
- **Code Structure**: Modular, well-documented
- **Testing**: Unit tests for critical functions
- **Logging**: Comprehensive logging for debugging
- **Documentation**: Complete setup and API docs

---

## 6. User Stories

### 6.1 Critical (P0)

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| US-1 | As a user, I want the bot to automatically detect expenses from my email | Bot scans email every 5 minutes and extracts transaction details |
| US-2 | As a user, I want to receive Telegram notifications for new transactions | Each transaction sends a Telegram message with details |
| US-3 | As a user, I want to categorize expenses as solo or joint | One-tap buttons for Solo/Joint classification |
| US-4 | As a user, I want to ignore non-expense transactions | Ignore button removes transaction from tracking |

### 6.2 High (P1)

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| US-5 | As a user, I want to edit transaction descriptions | Edit button allows description modification |
| US-6 | As a user, I want to match income with expenses | Income shows last 5 expenses for matching |
| US-7 | As a user, I want monthly summary reports | Auto-generated report on 1st of month |
| US-8 | As a user, I want transactions archived to Google Sheets | Automatic sync to Google Sheets |

### 6.3 Medium (P2)

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| US-9 | As a user, I want to view today's expenses | `/today` command shows daily summary |
| US-10 | As a user, I want to export data as CSV | `/export` command sends CSV file |
| US-11 | As a user, I want to manage categories | `/categories` shows all categories |

---

## 7. Technical Architecture

### 7.1 Technology Stack

| Component | Technology | Justification |
|-----------|------------|---------------|
| Backend | Python 3.11 | Rich ecosystem, easy to maintain |
| Web Framework | FastAPI | Modern, async, fast |
| Telegram Library | python-telegram-bot | Mature, feature-rich |
| Database | PostgreSQL | Reliable, hosted on Render |
| Email | IMAP (imaplib) | Standard protocol, no API limits |
| Archive | Google Sheets API | Free, accessible |
| Hosting | Render | Cloud, affordable, reliable |
| Version Control | Git/GitHub | Standard practice |

### 7.2 System Components

#### Email Scanner Service
```python
# Runs as background worker on Render
while True:
    emails = check_gmail_for_transactions()
    for email in emails:
        transaction = parse_transaction(email)
        if transaction:
            save_to_database(transaction)
            send_telegram_notification(transaction)
        mark_email_as_read(email)
    sleep(300)  # 5 minutes