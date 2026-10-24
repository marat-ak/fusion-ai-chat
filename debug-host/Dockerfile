# gnimsys/ai-chat-debug — the agent builders' debugger page (xxx-gnimsys-ai-chat host, spec §17.1) as a static image.
# Build context = the fusion-ai-chat repo root:
#   docker build -f debug-host/Dockerfile -t gnimsys/ai-chat-debug:latest .
# Stage 1 runs the repo's debug-host release build (JET 19, Redwood, Core Pack and the UX icon font all inside the build
# output; no CDN at runtime). Stage 2 is nginx serving it under /ai-chat-debug/. No env, no entry, no setup module.
FROM node:22-bookworm-slim AS build
WORKDIR /w
COPY package.json package-lock.json ./
RUN npm ci
# Oracle's UX icon font at the version oraclejetconfig.json pins, in its own layer (downloaded once per version).
COPY oraclejetconfig.json ./
COPY scripts/hooks/debug-host.js scripts/hooks/debug-host.js
RUN node scripts/hooks/debug-host.js fetch-icon-font
COPY tsconfig.json ./
COPY scripts/hooks/ scripts/hooks/
COPY src/ src/
COPY debug-host/index.html debug-host/index.html
RUN npm run build:debug-host

FROM nginx:1.27-alpine
COPY debug-host/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /w/web/ /usr/share/nginx/html/ai-chat-debug/
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
