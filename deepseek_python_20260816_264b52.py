# Runs as web service on Render
@app.post("/webhook")
async def webhook(request):
    update = parse_telegram_update(request)
    if update.is_callback_query:
        handle_button_click(update)
    elif update.is_message:
        handle_message(update)
    return {"status": "ok"}