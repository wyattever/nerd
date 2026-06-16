#!/bin/bash
# N.E.R.D. Google Drive Sync Script (Broad Reference)
# RESTRICTED ROOT: 15GjL2xX5JIX2S8CgUgmIh79xcFqlbcqC (gemini-code-repo)

ROOT_ID="15GjL2xX5JIX2S8CgUgmIh79xcFqlbcqC"

echo "🚀 Syncing broad reference to Drive (Restricted Root)..."

rclone sync ./ gdrive:nerd \
    --drive-root-folder-id "$ROOT_ID" \
    --exclude "/venv*/" \
    --exclude "/.pytest_cache/" \
    --exclude "/__pycache__/" \
    --exclude "/.git/" \
    --exclude ".DS_Store" \
    --exclude "/.github/" \
    --progress --fast-list
