#!/bin/sh
set -e

# Auto-generate NEXTAUTH_SECRET if not provided
if [ -z "$NEXTAUTH_SECRET" ] && [ -z "$AUTH_SECRET" ]; then
  export NEXTAUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
  echo "WARNING: No NEXTAUTH_SECRET set — generated a temporary one. Sessions will reset on container restart. Set NEXTAUTH_SECRET in your .env for persistence."
fi

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting MailFeed..."
exec node server.js
