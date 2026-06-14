#!/bin/bash
# N.E.R.D. Google Drive Pull Script
# Pulls Claude's drafts into a local dedicated folder

mkdir -p claude-drafts
rclone copy gdrive:gemini-code-repo/claude-drafts/ ./claude-drafts/ \
    --progress --fast-list
