# services/report_generator.py
import os
from datetime import datetime, timedelta
from database import db, Transaction, MonthlySummary
from services.telegram_bot import ExpenseBot

class ReportGenerator:
    def __init__(self):
        self.bot = ExpenseBot()
        
    async def generate_monthly_report(self):
        """Generate and send monthly report as text"""
        today = datetime.now()
        first_of_month = today.replace(day=1)
        last_month = first_of_month - timedelta(days=1)
        month_start = last_month.replace(day=1)
        
        # Query transactions for last month
        transactions = await db.query_transactions(month_start, first_of_month)
        
        # Calculate totals
        total_expense = sum(t.amount for t in transactions if t.transaction_type == 'expense' and t.expense_type != 'ignored')
        solo_expense = sum(t.amount for t in transactions if t.expense_type == 'solo')
        joint_expense = sum(t.amount for t in transactions if t.expense_type == 'joint')
        
        # Category breakdown
        categories = {}
        for t in transactions:
            if t.expense_type in ['solo', 'joint']:
                if t.category not in categories:
                    categories[t.category] = {'solo': 0, 'joint': 0}
                categories[t.category][t.expense_type] += t.amount
        
        # Generate report text
        report_text = self.format_report_text(
            month=last_month,
            total_expense=total_expense,
            solo_expense=solo_expense,
            joint_expense=joint_expense,
            categories=categories,
            transaction_count=len(transactions)
        )
        
        # Send via Telegram
        await self.bot.send_message(report_text)
        
        # Save summary to database
        await self.save_monthly_summary(report_text)
        
    def format_report_text(self, month, total_expense, solo_expense, joint_expense, categories, transaction_count):
        """Format the report as text"""
        report = f"""
📊 *Monthly Expense Report - {month.strftime('%B %Y')}*

━━━━━━━━━━━━━━━━━━━━
💰 *TOTAL EXPENSES*
━━━━━━━━━━━━━━━━━━━━
💳 Total Spend: ${total_expense:.2f}
👤 Solo Expenses: ${solo_expense:.2f} ({(solo_expense/total_expense*100):.0f}%)
👥 Joint Expenses: ${joint_expense:.2f} ({(joint_expense/total_expense*100):.0f}%)

━━━━━━━━━━━━━━━━━━━━
📂 *CATEGORY BREAKDOWN*
━━━━━━━━━━━━━━━━━━━━
"""
        # Add category breakdown
        emoji_map = {
            'Food & Dining': '🍔',
            'Transport': '🚗',
            'Groceries': '🛒',
            'Entertainment': '🎮',
            'Healthcare': '💊',
            'Household': '🏠',
            'Others': '📦'
        }
        
        for category, amounts in categories.items():
            emoji = emoji_map.get(category, '📌')
            report += f"\n{emoji} *{category}*:"
            if amounts['solo'] > 0:
                report += f"\n   👤 Solo: ${amounts['solo']:.2f}"
            if amounts['joint'] > 0:
                report += f"\n   👥 Joint: ${amounts['joint']:.2f}"
        
        report += f"""

━━━━━━━━━━━━━━━━━━━━
📈 *TRANSACTION SUMMARY*
━━━━━━━━━━━━━━━━━━━━
📊 Total Transactions: {transaction_count}
✅ Processed: {sum(1 for t in transactions if t.status == 'processed')}
🚫 Ignored: {sum(1 for t in transactions if t.expense_type == 'ignored')}

━━━━━━━━━━━━━━━━━━━━
💡 *MONTHLY INSIGHTS*
━━━━━━━━━━━━━━━━━━━━
"""
        # Add insights
        if total_expense > 0:
            report += f"📊 Average daily spend: ${total_expense/30:.2f}\n"
        
        top_category = max(categories.items(), key=lambda x: x[1]['solo'] + x[1]['joint'])
        report += f"🏆 Top spending category: {top_category[0]}"
        
        report += f"\n\n*Generated on {datetime.now().strftime('%b %d, %Y')}*"
        
        return report