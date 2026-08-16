# Clone repository
git clone https://github.com/yourusername/expense-tracker-bot.git
cd expense-tracker-bot

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env file
cp .env.example .env