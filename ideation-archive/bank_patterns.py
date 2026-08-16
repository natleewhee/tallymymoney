BANK_PATTERNS = {
    'dbs': {
        'domains': ['dbs.com.sg', 'dbs.com'],
        'amount_pattern': r'(?:SGD|S\$)\s*(\d+\.?\d*)',
        'merchant_pattern': r'at\s+([A-Za-z0-9\s]+)',
    },
    # Add new banks here
}