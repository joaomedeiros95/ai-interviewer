#!/bin/sh
set -e

python manage.py migrate --noinput
python manage.py seed_jobs || echo "seed skipped"

exec gunicorn config.wsgi \
  -b "0.0.0.0:${PORT:-8000}" \
  -w 2 \
  --worker-class gthread \
  --threads 8 \
  --timeout 120
