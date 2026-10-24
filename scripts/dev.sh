#!/usr/bin/env bash
# Runs INSIDE the CloudBeaver WSL distro. Every node/ojet/jest command goes through here:
#   wsl -d CloudBeaver -u root -e bash -lc 'bash /mnt/c/Marat/OSaaS/ClaudeShared/oservices/fusion-ai-chat/scripts/dev.sh <cmd...>'
# The repo is the checkout this script lives in (a git worktree mounts itself, not the main checkout).
# node_modules lives in the named volume <checkout>-nm (off the slow 9p mount).
# web/ (ojet staging) lives in the named volume <checkout>-web: staging onto the 9p share is slow and hangs.
# <checkout> = the checkout's directory name (fusion-ai-chat for the main checkout).
# Only the main checkout publishes :8000/:8787 (the VB dev loop's serve and mock pod): a worktree's runs (tests, builds)
# publish nothing, so they never collide with the main checkout's serve.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAME="$(basename "$REPO")"
PORTS=()
if [ "$NAME" = fusion-ai-chat ]; then PORTS=(-p 8000:8000 -p 8787:8787); fi
exec docker run --rm -i \
  -v "$REPO":/w \
  -v "$NAME"-nm:/w/node_modules \
  -v "$NAME"-web:/w/web \
  -w /w \
  "${PORTS[@]}" \
  -e CI=1 \
  node:22 bash -lc "$*"
