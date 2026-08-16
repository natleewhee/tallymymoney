# Create migration
alembic revision --autogenerate -m "Add new table"

# Apply migration
alembic upgrade head