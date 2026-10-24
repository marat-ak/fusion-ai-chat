#!/usr/bin/env bash
# Runs INSIDE the CloudBeaver WSL distro. Playwright e2e runner:
#   wsl -d CloudBeaver -u root -e bash -lc 'bash /mnt/c/Marat/OSaaS/ClaudeShared/oservices/fusion-ai-chat/scripts/e2e.sh <cmd...>'
# The repo is the checkout this script lives in (a git worktree mounts itself, not the main checkout).
# node_modules lives in the named volume <checkout>-nm (off the slow 9p mount).
# web/ (ojet staging) lives in the named volume <checkout>-e2e-web: staging onto the 9p share is slow and hangs.
# <checkout> = the checkout's directory name (fusion-ai-chat for the main checkout).
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="$(basename "$REPO")"
exec docker run --rm -i \
  -v "$REPO":/w \
  -v "$NAME"-nm:/w/node_modules \
  -v "$NAME"-e2e-web:/w/web \
  -w /w \
  -e CI=1 \
  mcr.microsoft.com/playwright:v1.56.0-noble bash -lc "$*"
