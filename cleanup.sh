#!/bin/bash

# ────────────────────────────────────────────────
# ZEN X - Automated Cache & Dead Session Cleanup
# ────────────────────────────────────────────────

BOT_DIR="$HOME/zenx"
cd "$BOT_DIR" || exit 1

echo "🧹 Starting cleanup... $(date)"
echo "----------------------------------------"

# 1. NPM cache
echo "→ Cleaning npm cache..."
npm cache clean --force >/dev/null 2>&1

# 2. Node modules cache
echo "→ Removing node_modules/.cache..."
rm -rf node_modules/.cache

# 3. PM2 logs (keep last 2 days)
echo "→ Cleaning old PM2 logs..."
find \~/.pm2/logs -type f -mtime +2 -delete 2>/dev/null

# 4. Temporary files
echo "→ Cleaning /tmp..."
rm -rf /tmp/* 2>/dev/null

# 5. Empty session folders
echo "→ Removing empty session folders..."
find sessions/ -type d -empty -delete 2>/dev/null

# 6. Old log files inside bot
echo "→ Removing old .log files..."
find . -name "*.log" -type f -mtime +3 -delete 2>/dev/null

# 7. Show current size
echo "----------------------------------------"
echo "✅ Cleanup finished!"
echo "Current bot size:"
du -sh .
echo "Sessions size:"
du -sh sessions/ 2>/dev/null
echo "----------------------------------------"
