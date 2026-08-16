# services/email_scanner.py
import asyncio
import imaplib
import email
from email.header import decode_header
import os
from datetime import datetime
import re
from database import db, Transaction
from services.telegram_notifier import send_transaction_notification

class EmailScanner:
    def __init__(self):
        self.email_address = os.getenv('GMAIL_USERNAME')
        self.app_password = os.getenv('GMAIL_APP_PASSWORD')
        self.scan_interval = int(os.getenv('SCAN_INTERVAL_MINUTES', 5))
        
    async def start_scanning(self):
        """Main loop that runs continuously on Render"""
        while True:
            try:
                await self.scan_emails()
                await asyncio.sleep(self.scan_interval * 60)
            except Exception as e:
                print(f"Error in email scanning: {e}")
                await asyncio.sleep(60)  # Retry after 1 minute on error
    
    async def scan_emails(self):
        # Connect to Gmail
        mail = imaplib.IMAP4_SSL("imap.gmail.com")
        mail.login(self.email_address, self.app_password)
        mail.select("inbox")
        
        # Search for unread emails from banks
        today = datetime.now().strftime("%d-%b-%Y")
        search_criteria = f'(UNSEEN SINCE {today})'
        _, messages = mail.search(None, search_criteria)
        
        for msg_id in messages[0].split():
            _, msg_data = mail.fetch(msg_id, "(RFC822)")
            email_body = msg_data[0][1]
            message = email.message_from_bytes(email_body)
            
            # Parse transaction
            transaction = self.parse_transaction_email(message)
            if transaction:
                # Save to database
                await self.save_transaction(transaction)
                # Send Telegram notification
                await send_transaction_notification(transaction)
            
            # Mark as read
            mail.store(msg_id, '+FLAGS', '\\Seen')
        
        mail.logout()
    
    def parse_transaction_email(self, message):
        """Parse transaction details from email"""
        # Get email subject and body
        subject = self.decode_email_header(message["Subject"])
        body = self.get_email_body(message)
        
        # Parse based on email sender patterns
        sender = message["From"]
        
        # Example patterns for different banks
        patterns = {
            'dbs.com.sg': r'(?:SGD|S\$)\s*(\d+\.?\d*).*?at\s+([A-Za-z0-9\s]+)',
            'ocbc.com': r'amount\s*(?:of\s*)?(?:SGD|S\$)\s*(\d+\.?\d*)',
            'citibank': r'Amount:\s*(?:SGD|S\$)\s*(\d+\.?\d*)',
        }
        
        # Extract amount and merchant
        for domain, pattern in patterns.items():
            if domain in sender:
                matches = re.findall(pattern, body, re.IGNORECASE)
                if matches:
                    amount = float(matches[0][0])
                    merchant = matches[0][1].strip() if len(matches[0]) > 1 else "Unknown"
                    return {
                        'amount': amount,
                        'merchant': merchant,
                        'description': subject,
                        'transaction_type': 'expense' if amount > 0 else 'income',
                        'email_message_id': message["Message-ID"],
                    }
        
        return None