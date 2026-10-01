#!/usr/bin/env python3
"""PostToolUse hook - backend.

Runs the relevant deterministic checker after the agent edits a file, and
blocks the turn if it fails. This turns "migrations must be idempotent" and
"every route needs a permission" from guidance into a loop the agent cannot
exit without fixing.

The same checkers run in CI (scripts/check_*.py), so this is fast feedback,
not the security boundary. Human-written code is caught by CI.

Contract: JSON on stdin, JSON on stdout. Exit 0 always - blocking is expressed
through {"decision": "block"} so a crash in this hook never wedges a session.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

TIMEOUT_SECONDS = 20

# Path prefix -> (checker script, human label). First match wins.
CHECKERS: list[tuple[str, str, str]] = [
    ("alembic/versions/", "scripts/check_migration_safety.py", "migration safety"),
    ("app/api/", "scripts/check_route_authz.py", "route authorization"),
    ("app/models/", "scripts/check_entity_registry.py", "entity registry"),
]


def _collect_paths(payload: object, found: set[str]) -> set[str]:
    """Walk the hook payload for anything that looks like an edited file path.

    Tool input shapes differ between tools and versions, so match on key name
    rather than assuming a fixed schema.
    """
    if isinstance(payload, dict):
        for key, value in payload.items():
            if (
                isinstance(value, str)
                and "path" in key.lower()
                and value.endswith((".py", ".css", ".ts", ".tsx", ".md"))
            ):
                found.add(value)
            else:
                _collect_paths(value, found)
    elif isinstance(payload, list):
        for item in payload:
            _collect_paths(item, found)
    return found


def _repo_root() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "scripts").is_dir() and (parent / ".github").is_dir():
            return parent
    return Path.cwd()


def _relative(path: str, root: Path) -> str:
    try:
        return str(Path(path).resolve().relative_to(root))
    except ValueError:
        return path


def _run(cmd: list[str], root: Path) -> tuple[int, str]:
    try:
        result = subprocess.run(
            cmd, cwd=root, capture_output=True, text=True, timeout=TIMEOUT_SECONDS
        )
        return result.returncode, (result.stdout + result.stderr).strip()
    except subprocess.TimeoutExpired:
        return 0, ""  # Never block on a slow checker.
    except (OSError, FileNotFoundError):
        return 0, ""  # Toolchain missing locally - CI still enforces.


def _format(path: str, root: Path) -> None:
    """Auto-format so formatting never shows up in a diff."""
    if not path.endswith(".py") or shutil.which("uv") is None:
        return
    _run(["uv", "run", "ruff", "format", path], root)
    _run(["uv", "run", "ruff", "check", "--fix", path], root)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        print(json.dumps({"continue": True}))
        return 0

    root = _repo_root()
    paths = sorted(_collect_paths(payload, set()))
    if not paths:
        print(json.dumps({"continue": True}))
        return 0

    failures: list[str] = []
    checked: set[str] = set()

    for raw in paths:
        rel = _relative(raw, root)
        _format(rel, root)

        for prefix, script, label in CHECKERS:
            if not rel.startswith(prefix):
                continue
            if label in checked:
                break
            checked.add(label)

            if not (root / script).is_file():
                break
            code, output = _run([sys.executable, script], root)
            if code != 0:
                failures.append(f"{label} check failed:\n{output}")
            break

    if failures:
        print(
            json.dumps(
                {
                    "decision": "block",
                    "reason": (
                        "\n\n".join(failures)
                        + "\n\nFix these before continuing. These are the rules in "
                        ".github/instructions/ - they are enforced, not advisory."
                    ),
                }
            )
        )
        return 0

    print(json.dumps({"continue": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
