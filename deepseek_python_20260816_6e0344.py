# services/telegram_bot.py
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import Application, CommandHandler, CallbackQueryHandler, MessageHandler, filters
import os
from datetime import datetime

class ExpenseBot:
    def __init__(self):
        self.token = os.getenv('TELEGRAM_BOT_TOKEN')
        self.chat_id = os.getenv('TELEGRAM_CHAT_ID')
        self.application = Application.builder().token(self.token).build()
        
    async def setup_webhook(self):
        """Setup webhook for Render deployment"""
        webhook_url = os.getenv('WEBHOOK_URL')
        await self.application.bot.set_webhook(f"{webhook_url}/webhook/{self.token}")
        
    async def send_transaction_notification(self, transaction):
        """Send transaction notification with action buttons"""
        keyboard = [
            [
                InlineKeyboardButton("👤 Solo", callback_data=f"solo_{transaction.id}"),
                InlineKeyboardButton("👥 Joint", callback_data=f"joint_{transaction.id}"),
            ],
            [
                InlineKeyboardButton("✏️ Edit Description", callback_data=f"edit_{transaction.id}"),
                InlineKeyboardButton("🚫 Ignore", callback_data=f"ignore_{transaction.id}"),
            ],
            [
                InlineKeyboardButton("💰 Income Match", callback_data=f"match_{transaction.id}"),
            ]
        ]
        
        reply_markup = InlineKeyboardMarkup(keyboard)
        
        message_text = f"""
💳 *New Transaction Detected*

━━━━━━━━━━━━━━━━━━━━
💰 Amount: ${abs(transaction.amount):.2f}
🏪 Merchant: {transaction.merchant}
📅 Date: {transaction.transaction_date.strftime('%d %b %Y, %I:%M %p')}
📝 Description: {transaction.description}

*How would you like to categorize this?*
"""
        
        await self.application.bot.send_message(
            chat_id=self.chat_id,
            text=message_text,
            reply_markup=reply_markup,
            parse_mode='Markdown'
        )
    
    async def handle_callback(self, update: Update, context):
        """Handle button clicks"""
        query = update.callback_query
        await query.answer()
        
        data = query.data
        action, transaction_id = data.split('_', 1)
        
        if action == 'solo':
            await self.categorize_transaction(transaction_id, 'solo')
            await query.edit_message_text(f"✅ Transaction marked as Solo expense")
        elif action == 'joint':
            await self.categorize_transaction(transaction_id, 'joint')
            await query.edit_message_text(f"✅ Transaction marked as Joint expense")
        elif action == 'ignore':
            await self.ignore_transaction(transaction_id)
            await query.edit_message_text(f"🚫 Transaction ignored")
        elif action == 'match':
            await self.show_matching_options(transaction_id, query)
        elif action == 'edit':
            await self.prompt_for_description(transaction_id, query)
    
    async def send_income_match_options(self, income_transaction):
        """Send options for matching income with past expenses"""
        # Get last 5 transactions
        past_transactions = await self.get_recent_transactions(5)
        
        keyboard = []
        for trans in past_transactions:
            keyboard.append([
                InlineKeyboardButton(
                    f"${trans.amount:.2f} - {trans.merchant} ({trans.transaction_date.strftime('%d %b')})",
                    callback_data=f"confirm_match_{income_transaction.id}_{trans.id}"
                )
            ])
        keyboard.append([InlineKeyboardButton("Skip", callback_data=f"skip_match_{income_transaction.id}")])
        
        message_text = f"""
💰 *Incoming Payment Detected*
Amount: ${abs(income_transaction.amount):.2f}
Description: {income_transaction.description}

*Which expense should this be matched with?*
"""
        
        await self.application.bot.send_message(
            chat_id=self.chat_id,
            text=message_text,
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode='Markdown'
        )