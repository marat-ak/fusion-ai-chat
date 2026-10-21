#!/usr/bin/env bash
# Runs INSIDE the CloudBeaver WSL distro. Every node/ojet/jest command goes through here:
#   wsl -d CloudBeaver -u root -e bash -lc 'bash /mnt/c/Marat/OSaaS/ClaudeShared/oservices/fusion-ai-chat/scripts/dev.sh <cmd...>'
# node_modules lives in the named volume fusion-ai-chat-nm (off the slow 9p mount).
set -euo pipefail
exec docker run --rm -i \
  -v /mnt/c/Marat/OSaaS/ClaudeShared/oservices/fusion-ai-chat:/w \
  -v fusion-ai-chat-nm:/w/node_modules \
  -w /w \
  -p 8000:8000 -p 8787:8787 \
  -e CI=1 \
  node:22 bash -lc "$*"
