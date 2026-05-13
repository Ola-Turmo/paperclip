#!/bin/sh
set -e

# Capture runtime UID/GID from environment variables, defaulting to 1000
PUID=${USER_UID:-1000}
PGID=${USER_GID:-1000}
RUNTIME_HOME=${PAPERCLIP_HOME:-${HOME:-/home/.paperclip}}
SEED_ROOT=${PAPERCLIP_RUNTIME_SEED_ROOT:-/paperclip-seed}

sync_seed_dir() {
    src="$1"
    dest="$2"
    shift 2
    if [ ! -d "$src" ]; then
        return 0
    fi
    mkdir -p "$dest"
    rsync -a "$@" "$src"/ "$dest"/
}

# Adjust the node user's UID/GID if they differ from the runtime request
# and fix volume ownership only when a remap is needed
changed=0

if [ "$(id -u node)" -ne "$PUID" ]; then
    echo "Updating node UID to $PUID"
    usermod -o -u "$PUID" node
    changed=1
fi

if [ "$(id -g node)" -ne "$PGID" ]; then
    echo "Updating node GID to $PGID"
    groupmod -o -g "$PGID" node
    usermod -g "$PGID" node
    changed=1
fi

if [ "$changed" = "1" ]; then
    chown -R node:node "$RUNTIME_HOME"
fi

mkdir -p "$RUNTIME_HOME" "$RUNTIME_HOME/.config"

# Seed runtime auth and config homes from the VPS host's signed-in CLI state.
# This keeps Paperclip's agent runtime self-contained while reusing the
# operator's existing authenticated tool sessions.
sync_seed_dir "$SEED_ROOT/.codex" "$RUNTIME_HOME/.codex" \
    --exclude=config.toml \
    --exclude=config.toml3 \
    --exclude=AGENTS.md \
    --exclude=cache \
    --exclude=history.jsonl \
    --exclude=logs \
    --exclude=logs_*.sqlite \
    --exclude=memories \
    --exclude=sessions \
    --exclude=shell_snapshots \
    --exclude=statsig
sync_seed_dir "$SEED_ROOT/.gemini" "$RUNTIME_HOME/.gemini" \
    --exclude=gemini-credentials.json \
    --exclude=tmp \
    --exclude=logs
sync_seed_dir "$SEED_ROOT/.pi" "$RUNTIME_HOME/.pi" \
    --exclude=sessions \
    --exclude=tmp
sync_seed_dir "$SEED_ROOT/opencode" "$RUNTIME_HOME/.config/opencode"
sync_seed_dir "$SEED_ROOT/opencode-share" "$RUNTIME_HOME/.local/share/opencode" \
    --exclude=log \
    --exclude=opencode.db \
    --exclude=opencode.db-shm \
    --exclude=opencode.db-wal \
    --exclude=snapshot \
    --exclude=storage
sync_seed_dir "$SEED_ROOT/gh" "$RUNTIME_HOME/.config/gh"
sync_seed_dir "$SEED_ROOT/ssh" "$RUNTIME_HOME/.ssh"
sync_seed_dir "$SEED_ROOT/.hermes" "$RUNTIME_HOME/.hermes" \
    --exclude=hermes-agent \
    --exclude=logs \
    --exclude=cache \
    --exclude=runtime \
    --exclude=checkpoints \
    --exclude=sessions \
    --exclude=prd \
    --exclude=node_modules \
    --exclude=.git \
    --exclude=__pycache__ \
    --exclude=.venv \
    --exclude=venv \
    --exclude=*.sqlite \
    --exclude=*.log
if [ -f "$SEED_ROOT/.gitconfig" ]; then
    cp "$SEED_ROOT/.gitconfig" "$RUNTIME_HOME/.gitconfig"
fi
mkdir -p "$RUNTIME_HOME/.local/share"
if [ -f "$SEED_ROOT/.codex/config.toml" ]; then
    python3 - "$SEED_ROOT/.codex/config.toml" "$RUNTIME_HOME/.codex/config.toml" <<'PY'
import sys
import tomllib
from pathlib import Path

src, dst = sys.argv[1], sys.argv[2]
data = tomllib.loads(Path(src).read_text(encoding="utf-8"))
provider_name = data.get("model_provider") or "theclawbay"
providers = data.get("model_providers") or {}
provider = providers.get(provider_name) or {}

lines = [
    'model = "gpt-5.4"',
    f'model_provider = "{provider_name}"' if provider else 'model_provider = "openai"',
    'approval_policy = "never"',
    'sandbox_mode = "danger-full-access"',
    'model_reasoning_effort = "high"',
    "",
    "[features]",
    "multi_agent = true",
]

if provider:
    lines.append("")
    lines.append(f"[model_providers.{provider_name}]")
    for key in ("name", "base_url", "wire_api", "experimental_bearer_token"):
        value = provider.get(key)
        if isinstance(value, str) and value:
            escaped = value.replace("\\", "\\\\").replace('"', '\\"')
            lines.append(f'{key} = "{escaped}"')
    for key in ("requires_openai_auth", "supports_websockets"):
        value = provider.get(key)
        if isinstance(value, bool):
            lines.append(f"{key} = {'true' if value else 'false'}")

Path(dst).write_text("\n".join(lines) + "\n", encoding="utf-8")
PY
else
    cat > "$RUNTIME_HOME/.codex/config.toml" <<'EOF'
model = "gpt-5.4"
approval_policy = "never"
sandbox_mode = "danger-full-access"
model_reasoning_effort = "high"

[features]
multi_agent = true
EOF
fi

# Avoid recursively chowning the whole persistent Paperclip home on every start;
# the volume contains long-lived runtime/session data and can make deploys look hung.
chown node:node "$RUNTIME_HOME" "$RUNTIME_HOME/.config" "$RUNTIME_HOME/.local" "$RUNTIME_HOME/.local/share" 2>/dev/null || true
for seeded_path in \
    "$RUNTIME_HOME/.codex" \
    "$RUNTIME_HOME/.gemini" \
    "$RUNTIME_HOME/.pi" \
    "$RUNTIME_HOME/.config/opencode" \
    "$RUNTIME_HOME/.local/share/opencode" \
    "$RUNTIME_HOME/.config/gh" \
    "$RUNTIME_HOME/.ssh" \
    "$RUNTIME_HOME/.gitconfig" \
    "$RUNTIME_HOME/.hermes"
do
    if [ -e "$seeded_path" ]; then
        chown -R node:node "$seeded_path"
    fi
done
if [ -d "$RUNTIME_HOME/.ssh" ]; then
    chmod 700 "$RUNTIME_HOME/.ssh"
    find "$RUNTIME_HOME/.ssh" -type f -exec chmod 600 {} \;
fi

exec gosu node "$@"
