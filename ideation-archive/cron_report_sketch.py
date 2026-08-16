# Runs as cron job on 1st of month
def generate_report():
    last_month = get_last_month()
    transactions = get_transactions(last_month)
    report = format_report(transactions)
    send_telegram_message(report)
    save_report_to_database(report)