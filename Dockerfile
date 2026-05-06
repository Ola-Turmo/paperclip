FROM node:lts-trixie-slim AS base
ARG PAPERCLIP_REF=a95739442027bdec8d291030a91e351dc434f635
ARG PAPERCLIP_SOURCE_REF=master
ARG PAPERCLIP_SOURCE_COMMIT=a95739442027bdec8d291030a91e351dc434f635
ARG PAPERCLIP_RELEASE_TAG=
ARG PAPERCLIP_RELEASE_COMMIT=a95739442027bdec8d291030a91e351dc434f635
ARG USER_UID=1000
ARG USER_GID=1000
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates gosu curl gh git wget ripgrep python3 rsync \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

# Modify the existing node user/group to have the specified UID/GID to match host user
RUN usermod -u $USER_UID --non-unique node \
  && groupmod -g $USER_GID --non-unique node \
  && usermod -g $USER_GID -d /paperclip node

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY cli/package.json cli/
COPY server/package.json server/
COPY ui/package.json ui/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/adapter-utils/package.json packages/adapter-utils/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/adapters/claude-local/package.json packages/adapters/claude-local/
COPY packages/adapters/codex-local/package.json packages/adapters/codex-local/
COPY packages/adapters/cursor-cloud/package.json packages/adapters/cursor-cloud/
COPY packages/adapters/cursor-local/package.json packages/adapters/cursor-local/
COPY packages/adapters/gemini-local/package.json packages/adapters/gemini-local/
COPY packages/adapters/openclaw-gateway/package.json packages/adapters/openclaw-gateway/
COPY packages/adapters/opencode-local/package.json packages/adapters/opencode-local/
COPY packages/adapters/pi-local/package.json packages/adapters/pi-local/
COPY packages/plugins/sdk/package.json packages/plugins/sdk/
COPY --parents packages/plugins/sandbox-providers/./*/package.json packages/plugins/sandbox-providers/
COPY packages/plugins/paperclip-plugin-fake-sandbox/package.json packages/plugins/paperclip-plugin-fake-sandbox/
COPY packages/plugins/plugin-llm-wiki/package.json packages/plugins/plugin-llm-wiki/
COPY patches/ patches/

RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app /app
COPY . .
RUN pnpm --filter @paperclipai/ui build
RUN pnpm --filter @paperclipai/plugin-sdk build
RUN pnpm --filter @paperclipai/server build
RUN test -f server/dist/index.js || (echo "ERROR: server build output missing" && exit 1)

FROM base AS production
ARG PAPERCLIP_SOURCE_REF
ARG PAPERCLIP_SOURCE_COMMIT
ARG PAPERCLIP_RELEASE_TAG
ARG PAPERCLIP_RELEASE_COMMIT
ARG USER_UID=1000
ARG USER_GID=1000
WORKDIR /app
COPY --chown=node:node --from=build /app /app
RUN npm install --global --omit=dev @google/gemini-cli@latest @mariozechner/pi-coding-agent@latest @openai/codex@latest opencode-ai @zapier/zapier-sdk-cli@latest \
  && node -e "const { execSync } = require('node:child_process'); const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim(); const codexVersion = require(globalRoot + '/@openai/codex/package.json').version; const platformByArch = { x64: 'linux-x64', arm64: 'linux-arm64' }; const codexPlatform = platformByArch[process.arch]; if (!codexPlatform) { console.error('Unsupported Codex platform arch:', process.arch); process.exit(1); } const packageSpec = '@openai/codex-' + codexPlatform + '@npm:@openai/codex@' + codexVersion + '-' + codexPlatform; execSync('npm install -g --omit=dev ' + packageSpec, { stdio: 'inherit' });" \
  && apt-get update \
  && apt-get install -y --no-install-recommends openssh-client jq \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /paperclip /home/.paperclip /opt/hermes-agent /opt/uv-python \
  && chown node:node /paperclip /home/.paperclip \
  && printf '%s\n' '#!/bin/sh' 'set -e' 'PYTHON_BIN=/usr/bin/python3' '[ -x "$PYTHON_BIN" ] || { echo "Hermes runtime Python not found at $PYTHON_BIN" >&2; exit 127; }' 'PYVER=$("$PYTHON_BIN" -c '\''import sys; print("%d.%d" % sys.version_info[:2])'\'')' 'export VIRTUAL_ENV=/opt/hermes-agent/venv' 'export PYTHONPATH=/opt/hermes-agent/src:/opt/hermes-agent/venv/lib/python${PYVER}/site-packages${PYTHONPATH:+:$PYTHONPATH}' 'exec "$PYTHON_BIN" -m hermes_cli.main "$@"' > /usr/local/bin/hermes \
  && chmod +x /usr/local/bin/hermes

COPY scripts/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production \
  HOME=/home/.paperclip \
  HOST=0.0.0.0 \
  PORT=3100 \
  SERVE_UI=true \
  PAPERCLIP_HOME=/home/.paperclip \
  PAPERCLIP_INSTANCE_ID=default \
  USER_UID=${USER_UID} \
  USER_GID=${USER_GID} \
  PAPERCLIP_CONFIG=/home/.paperclip/instances/default/config.json \
  PAPERCLIP_DEPLOYMENT_MODE=authenticated \
  PAPERCLIP_DEPLOYMENT_EXPOSURE=private \
  PAPERCLIP_SOURCE_REF=${PAPERCLIP_SOURCE_REF} \
  PAPERCLIP_SOURCE_COMMIT=${PAPERCLIP_SOURCE_COMMIT} \
  PAPERCLIP_RELEASE_TAG=${PAPERCLIP_RELEASE_TAG} \
  PAPERCLIP_RELEASE_COMMIT=${PAPERCLIP_RELEASE_COMMIT} \
  OPENCODE_ALLOW_ALL_MODELS=true \
  XDG_CONFIG_HOME=/home/.paperclip/.config

VOLUME ["/home/.paperclip"]
EXPOSE 3100

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--import", "./server/node_modules/tsx/dist/loader.mjs", "server/dist/index.js"]
