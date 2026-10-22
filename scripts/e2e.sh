#!/usr/bin/env bash
# Runs INSIDE the CloudBeaver WSL distro. Playwright e2e runner:
#   wsl -d CloudBeaver -u root -e bash -lc 'bash /mnt/c/Marat/OSaaS/ClaudeShared/oservices/fusion-ai-chat/scripts/e2e.sh <cmd...>'
# node_modules lives in the named volume fusion-ai-chat-nm (off the slow 9p mount).
# web/ (ojet staging) lives in the named volume fusion-ai-chat-e2e-web: staging onto the 9p share is slow and hangs.
set -euo pipefail
exec docker run --rm -i \
  -v /mnt/c/Marat/OSaaS/ClaudeShared/oservices/fusion-ai-chat:/w \
  -v fusion-ai-chat-nm:/w/node_modules \
  -v fusion-ai-chat-e2e-web:/w/web \
  -w /w \
  -e CI=1 \
  mcr.microsoft.com/playwright:v1.56.0-noble bash -lc "$*"
