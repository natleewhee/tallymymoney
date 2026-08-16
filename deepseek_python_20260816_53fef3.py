# app.py
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import os
from services.telegram_bot import ExpenseBot
from services.email_scanner import EmailScanner
import asyncio

app = FastAPI()
bot = ExpenseBot()

@app.on_event("startup")
async def startup():
    """Setup webhook on startup"""
    await bot.setup_webhook()

@app.post("/webhook/{token}")
async def webhook(token: str, request: Request):
    """Handle Telegram webhook"""
    if token != os.getenv('TELEGRAM_BOT_TOKEN'):
        return JSONResponse(status_code=403, content={"error": "Invalid token"})
    
    update = await request.json()
    await bot.application.process_update(update)
    return JSONResponse(status_code=200, content={"status": "ok"})

@app.get("/health")
async def health_check():
    """Health check endpoint for Render"""
    return {"status": "healthy"}

# For local testing
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)