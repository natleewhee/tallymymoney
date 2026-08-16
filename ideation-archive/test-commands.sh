# Run all tests
pytest

# Run specific test file
pytest tests/test_email_scanner.py

# Run with coverage
pytest --cov=services --cov=utils --cov-report=html