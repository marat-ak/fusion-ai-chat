#!/usr/bin/env bash
# Runs INSIDE the CloudBeaver WSL distro. Every node/ojet/jest command goes through here:
#   wsl -d CloudBeaver -u root -e bash -lc 'bash /mnt/c/Marat/OSaaS/ClaudeShared/oservices/fusion-ai-chat/scripts/dev.sh <cmd...>'
# node_modules lives in the named volume fusion-ai-chat-nm (off the slow 9p mount).
# web/ (ojet staging) lives in the named volume fusion-ai-chat-web: staging onto the 9p share is slow and hangs.
set -euo pipefail
exec docker run --rm -i \
  -v /mnt/c/Marat/OSaaS/ClaudeShared/oservices/fusion-ai-chat:/w \
  -v fusion-ai-chat-nm:/w/node_modules \
  -v fusion-ai-chat-web:/w/web \
  -w /w \
  -p 8000:8000 -p 8787:8787 \
  -e CI=1 \
  node:22 bash -lc "$*"
