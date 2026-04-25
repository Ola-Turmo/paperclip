import argparse
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_POLICY_PATH = Path("/home/.paperclip/provider-tooling/provider-governance.json")
if not DEFAULT_POLICY_PATH.exists():
    DEFAULT_POLICY_PATH = ROOT / "references" / "provider-governance.json"


def load_policy(path: Path):
    with path.open("r", encoding="utf-8-sig") as fh:
        return json.load(fh)


def company_policy(policy: dict, provider: str, company: str):
    provider_policy = policy["providers"][provider]
    if company not in provider_policy["companies"]:
        raise SystemExit(f"No {provider} policy for company {company}")
    return provider_policy["companies"][company]


def classify_cloudflare(args: list[str]) -> str:
    joined = " ".join(args).lower()
    if any(token in joined for token in [" browser", " flagship", " artifact"]):
        return "unsupported"
    if any(token in joined for token in [" delete", " remove", " purge", " rollback", " teardown"]):
        return "destructive"
    if args[:1] == ["email"]:
        if any(token in joined for token in [" create", " put", " add", " enable", " disable", " update", " set", " issue", " configure"]):
            return "write"
        return "read"
    if args[:1] == ["whoami"]:
        return "identity"
    if any(token in joined for token in [" deploy", " publish", " apply", " create", " put", " secret", " migrate", " upload"]):
        return "write"
    return "read"


def classify_zapier(args: list[str]) -> str:
    if not args:
        return "catalog"
    command = args[0]
    if command in {"get-profile", "login", "logout"}:
        return "identity"
    if command in {"apps", "integrations", "describe", "history", "versions", "version", "logs"}:
        return "catalog"
    if command in {"env", "users", "team", "analytics", "jobs"}:
        return "connection-read"
    if command in {"build", "validate", "init", "scaffold", "convert", "link", "pull"}:
        return "build"
    if command in {"invoke"}:
        return "action-run"
    if command in {"push", "upload", "register", "promote", "migrate", "deprecate", "legacy", "canary", "delete"}:
        return "credentials-mutate"
    if command in {
        "list-apps", "get-app", "list-actions", "get-action", "list-input-fields",
        "list-input-field-choices", "get-input-fields-schema",
    }:
        return "catalog"
    if command in {"list-connections", "get-connection", "find-first-connection", "find-unique-connection"}:
        return "connection-read"
    if command in {"init", "add", "build-manifest", "generate-app-types", "bundle-code", "mcp"}:
        return "build"
    if command in {"run-action"}:
        return "action-run"
    if command in {"create-client-credentials", "delete-client-credentials"}:
        return "credentials-mutate"
    if command in {
        "create-table", "create-table-fields", "create-table-records", "delete-table",
        "delete-table-fields", "delete-table-records", "update-table-records",
    }:
        return "table-mutate"
    return "catalog"


def classify_composio(args: list[str]) -> str:
    if not args:
        return "catalog"
    command = args[0]
    destructive = {"delete", "remove", "rm", "revoke", "purge"}
    if command in {"login", "logout", "whoami", "orgs", "version", "config", "files"}:
        return "identity"
    if command in {"search", "tools", "triggers", "generate"}:
        return "catalog"
    if command == "connections":
        if len(args) > 1 and args[1] in destructive:
            return "credentials-mutate"
        return "connection-read"
    if command == "link":
        return "credentials-mutate"
    if command == "execute":
        return "action-run"
    if command == "run":
        return "workflow-run"
    if command == "proxy":
        return "proxy"
    if command in {"dev", "upgrade"}:
        return "admin"
    return "catalog"


def extract_composio_toolkits(args: list[str]) -> set[str]:
    toolkits: set[str] = set()
    if not args:
        return toolkits
    command = args[0]
    for idx, item in enumerate(args):
        if item == "--toolkits" and idx + 1 < len(args):
            toolkits.update(t.strip().lower() for t in args[idx + 1].split(",") if t.strip())
        elif item.startswith("--toolkits="):
            toolkits.update(t.strip().lower() for t in item.split("=", 1)[1].split(",") if t.strip())
        elif item == "--toolkit" and idx + 1 < len(args):
            toolkits.add(args[idx + 1].strip().lower())
        elif item.startswith("--toolkit="):
            toolkits.add(item.split("=", 1)[1].strip().lower())
    if command == "link" and len(args) > 1 and not args[1].startswith("-"):
        toolkits.add(args[1].lower())
    if command in {"tools", "triggers"} and len(args) > 2 and args[1] in {"list", "info"} and not args[2].startswith("-"):
        value = args[2].lower()
        if "_" in value:
            value = value.split("_", 1)[0]
        toolkits.add(value)
    if command == "execute":
        for item in args[1:]:
            if item.startswith("-"):
                continue
            if item in {"-d", "--data", "--file"}:
                continue
            if item.upper() == item and "_" in item:
                toolkits.add(item.split("_", 1)[0].lower())
                break
    return {t.replace("-", "_") for t in toolkits if t}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", required=True, choices=["cloudflare", "zapier", "composio"])
    parser.add_argument("--company", required=True)
    parser.add_argument("--policy-path", default=str(DEFAULT_POLICY_PATH))
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()

    policy = load_policy(Path(args.policy_path))
    cp = company_policy(policy, args.provider, args.company)

    if cp["mode"].startswith("deny"):
        raise SystemExit(f"{args.provider} access denied for {args.company}: {cp['forbiddenUsecases'][0]}")

    command = args.command[1:] if args.command and args.command[0] == "--" else args.command
    if not command:
        raise SystemExit("No command provided")

    if args.provider == "cloudflare":
        cmd_class = classify_cloudflare(command)
    elif args.provider == "zapier":
        cmd_class = classify_zapier(command)
    else:
        cmd_class = classify_composio(command)
    allowed = set(cp.get("allowedCommandClasses", []))
    if cmd_class not in allowed:
        raise SystemExit(f"{args.provider} command class '{cmd_class}' is not allowed for {args.company}")

    if args.provider == "composio":
        requested_toolkits = extract_composio_toolkits(command)
        allowed_toolkits = {t.replace("-", "_").lower() for t in cp.get("allowedToolkits", [])}
        if requested_toolkits and allowed_toolkits:
            denied_toolkits = requested_toolkits - allowed_toolkits
            if denied_toolkits:
                raise SystemExit(f"composio toolkit(s) {sorted(denied_toolkits)} are not allowed for {args.company}")
        tool_root = Path("/home/.paperclip/provider-tooling/composio")
        company_root = tool_root / "companies" / args.company
        env = os.environ.copy()
        env["HOME"] = str(company_root / "home")
        env["XDG_CONFIG_HOME"] = str(company_root / "home" / ".config")
        env["COMPOSIO_CACHE_DIR"] = str(company_root / "cache")
        env["COMPOSIO_SESSION_DIR"] = str(company_root / "sessions")
        env["COMPOSIO_DISABLE_TELEMETRY"] = "1"
        env.setdefault("COMPOSIO_LOG_LEVEL", "info")
        for key in ["HOME", "XDG_CONFIG_HOME", "COMPOSIO_CACHE_DIR", "COMPOSIO_SESSION_DIR"]:
            Path(env[key]).mkdir(parents=True, exist_ok=True)
        cli = tool_root / "composio"
        result = subprocess.run([str(cli), *command], env=env)
        return result.returncode

    if args.provider == "cloudflare":
        tool_root = Path("/home/.paperclip/provider-tooling/cloudflare")
        env = os.environ.copy()
        env["HOME"] = str(tool_root / "home")
        cli = tool_root / "node_modules" / ".bin" / "wrangler"
        result = subprocess.run([str(cli), *command], env=env)
        return result.returncode

    tool_root = Path("/home/.paperclip/provider-tooling/zapier")
    env = os.environ.copy()
    env["HOME"] = str(tool_root / "home")
    env["XDG_CONFIG_HOME"] = str(tool_root / "home" / ".config")
    env["APPDATA"] = str(tool_root / "home" / ".config")
    env["ZAPIER_SUPPRESS_DEPRECATION_WARNING"] = "1"
    cli = tool_root / "node_modules" / ".bin" / "zapier-sdk"
    result = subprocess.run([str(cli), *command], env=env)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())