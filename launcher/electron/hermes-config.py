"""Add one named Hermes provider; input is private stdin, stdout is a redacted receipt."""
import hashlib
import http.client
import json
import os
from pathlib import Path
import secrets
import sys
import tempfile
from datetime import datetime, timezone

import yaml


def atomic(path, text):
    descriptor, temporary = tempfile.mkstemp(prefix=".codex-web-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def install(options):
    home = Path(options["hermesHome"])
    core = Path(options["coreHome"])
    config_path = home / "config.yaml"
    if not config_path.is_file() or config_path.is_symlink():
        raise ValueError("Open Hermes and complete its initial setup before adding this provider.")
    if config_path.stat().st_size > 1024 * 1024:
        raise ValueError("Hermes config is too large to safely edit automatically.")
    original = config_path.read_text(encoding="utf-8")
    config = yaml.safe_load(original)
    if not isinstance(config, dict) or not isinstance(config.get("providers", {}), dict):
        raise ValueError("Hermes providers configuration is not a mapping; resolve it in Hermes first.")
    providers = config.setdefault("providers", {})
    endpoint = f'http://127.0.0.1:{options["port"]}/hermes/v1'
    previous = providers.get("codex-web")
    receipt_path = core / "hermes" / "installation.json"
    receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else {}
    if previous is not None and hashlib.sha256(json.dumps(previous, sort_keys=True).encode()).hexdigest() != receipt.get("providerHash"):
        raise ValueError("Hermes already has a modified codex-web provider. Keep it or rename it in Hermes before reinstalling.")
    secret_dir = core / "hermes"
    secret_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    token_path = secret_dir / "provider-token"
    if token_path.is_symlink():
        raise ValueError("The Hermes connection token must be a private regular file.")
    token = token_path.read_text().strip() if token_path.exists() else secrets.token_hex(32)
    if len(token) != 64 or any(c not in "0123456789abcdef" for c in token):
        raise ValueError("The Hermes connection token is invalid; repair the local provider setup.")
    atomic(token_path, token + "\n")
    # Use the running bridge's canonical per-model limits. Direct loopback HTTP ignores PAC/env
    # proxies and does not follow redirects with this private local credential.
    connection = http.client.HTTPConnection("127.0.0.1", options["port"], timeout=5)
    try:
        connection.request("GET", "/hermes/v1/models", headers={"Authorization": "Bearer " + token})
        response = connection.getresponse()
        if response.status != 200:
            raise ValueError("Start the updated Codex Web GPT runtime before adding Hermes.")
        models = json.loads(response.read(128 * 1024)).get("data", [])
    finally:
        connection.close()
    if not models or any(not isinstance(model.get("context_length"), int) or model["context_length"] < 64000 for model in models):
        raise ValueError("The active bridge has no Hermes-compatible model catalog. Update the app and choose an account mode with at least 64k usable context.")
    names = [model["id"] for model in models]
    provider = {
        "name": "ChatGPT Web · FroRaut",
        "api": endpoint,
        "api_key": token,
        "transport": "codex_responses",
        "default_model": "chatgpt-web/high" if "chatgpt-web/high" in names else names[0],
        "discover_models": True,
        "models": {model["id"]: {"context_length": model["context_length"], "vision": True,
                          "tool_calling": True, "openai_native_compaction": False}
                   for model in models},
        "capabilities": {"openai_native_compaction": False},
    }
    providers["codex-web"] = provider
    updated = yaml.safe_dump(config, allow_unicode=True, sort_keys=False)
    backup_dir = home / "backups" / "codex-web"
    backup_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    backup = backup_dir / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + "-config.yaml")
    atomic(backup, original)
    # Catch settings saved while the form was preparing. Never overwrite concurrent edits.
    if config_path.read_text(encoding="utf-8") != original:
        raise ValueError("Hermes settings changed during setup; retry when its settings are saved.")
    atomic(token_path, token + "\n")
    atomic(config_path, updated)
    result = {"provider": "codex-web", "configPath": str(config_path), "backupPath": str(backup),
              "baseUrl": endpoint, "defaultChanged": False,
              "providerHash": hashlib.sha256(json.dumps(provider, sort_keys=True).encode()).hexdigest()}
    atomic(receipt_path, json.dumps(result, indent=2) + "\n")
    return {key: value for key, value in result.items() if key != "providerHash"}


if __name__ == "__main__":
    try:
        print(json.dumps(install(json.load(sys.stdin))))
    except Exception as error:
        # Do not print YAML snippets, credentials, traceback locals or arbitrary exception text.
        print(json.dumps({"error": str(error) if isinstance(error, ValueError)
                          else "Hermes setup could not update its configuration. Check file access and the Hermes Python installation."}))
        sys.exit(1)
