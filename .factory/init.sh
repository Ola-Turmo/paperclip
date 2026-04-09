#!/usr/bin/env bash
set -euo pipefail

cd /root/work/paperclip

# Ensure system PostgreSQL is running (required for this mission on root environments)
if ! pg_isready -p 5433 >/dev/null 2>&1; then
  pg_ctlcluster 16 main start 2>/dev/null || true
fi

# Wait for PostgreSQL to be ready
for i in $(seq 1 10); do
  if pg_isready -p 5433 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if [ ! -d node_modules ]; then
  pnpm install
fi
