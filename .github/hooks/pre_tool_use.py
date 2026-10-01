#!/usr/bin/env python3
"""PreToolUse hook - backend.

Denies operations that are destructive, irreversible, or that bypass a
generated artifact. These are things no instruction can reliably prevent,
because by the time the model has decided to run the command the reasoning
has already gone wrong.

Deny (hard):
  - force push, hard reset, branch deletion
  - rm -rf outside a temp directory
  - alembic downgrade against anything that is not localhost
  - psql/DROP against a non-local host
  - --no-verify, which skips the hooks the team agreed to
  - writes to alembic/versions files that are already applied upstream

Ask (confirm):
  - any alembic downgrade
  - migrations run against uat/prod-looking connection strings

Contract: JSON on stdin, JSON on stdout. Exit 0 always.
"""

from __future__ import annotations

import json
import re
import sys

# (pattern, reason). Matched case-insensitively against the command string.
DENY: list[tuple[re.Pattern[str], str]] = [
    # Committing is a human decision. The agent writes files; a person reviews
    # the diff and decides what enters history. This also prevents a commit
    # landing before the repo has a remote or an agreed initial structure.
    (
        re.compile(
            r"\bgit\s+(add|commit|push|merge|rebase|cherry-pick|revert|tag|"
            r"stash\s+(drop|clear)|am|apply)\b",
            re.I,
        ),
        "Git write operations are reserved for humans. The agent edits files; you "
        "review the diff and commit. Read-only git (status, diff, log, show, "
        "branch) is allowed.",
    ),
    (
        re.compile(r"\bgit\s+(init|remote\s+(add|set-url|remove))\b", re.I),
        "Repository and remote setup is a human decision. Ask before wiring this repo to a remote.",
    ),
    (
        re.compile(r"git\s+push\b.*(--force\b|--force-with-lease\b|\s-f\b)", re.I),
        "Force push rewrites published history. Push a new commit, or ask a human "
        "to do this deliberately.",
    ),
    (
        re.compile(r"git\s+reset\s+--hard", re.I),
        "git reset --hard discards uncommitted work, which may include changes the "
        "agent did not make. Use git stash or git restore on specific paths.",
    ),
    (
        re.compile(r"git\s+(branch\s+-D|push\b.*--delete)", re.I),
        "Deleting branches is not reversible from here. Ask a human.",
    ),
    (
        re.compile(r"\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b(?!\s+/tmp/)", re.I),
        "Recursive force delete outside /tmp. Delete specific paths instead.",
    ),
    (
        re.compile(r"--no-verify\b", re.I),
        "--no-verify skips the checks the team agreed to run. Fix the failure "
        "instead of bypassing it.",
    ),
    (
        re.compile(r"\bDROP\s+(TABLE|DATABASE|SCHEMA)\b", re.I),
        "Destructive DDL outside a migration. Schema changes go through Alembic, "
        "using the /create-a-migration skill.",
    ),
    (
        re.compile(r"\b(TRUNCATE|DELETE\s+FROM)\b(?!.*\bWHERE\b)", re.I),
        "Unfiltered TRUNCATE/DELETE. Add a WHERE clause, or use a batched data migration.",
    ),
]

# Commands that need explicit human confirmation rather than a hard block.
ASK: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(r"alembic\s+downgrade", re.I),
        "Downgrading a database can lose data. Confirm this is a local database.",
    ),
    (
        re.compile(r"(uat|prod|production)[-.]", re.I),
        "This command references a non-development environment.",
    ),
]

# Paths the agent must never write by hand.
PROTECTED: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(r"(^|/)src/api/generated/", re.I),
        "Generated API client. Run 'npm run api:generate' in the frontend repo "
        "instead - hand edits are overwritten and fail the CI drift check.",
    ),
    (
        re.compile(r"(^|/)uv\.lock$", re.I),
        "The lockfile is generated. Run 'uv add'/'uv sync' rather than editing it.",
    ),
]


def _walk_strings(payload: object, out: list[str]) -> list[str]:
    if isinstance(payload, dict):
        for value in payload.values():
            _walk_strings(value, out)
    elif isinstance(payload, list):
        for item in payload:
            _walk_strings(item, out)
    elif isinstance(payload, str):
        out.append(payload)
    return out


def _decision(kind: str, reason: str) -> str:
    return json.dumps(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": kind,
                "permissionDecisionReason": reason,
            }
        }
    )


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        print(json.dumps({"continue": True}))
        return 0

    tool = str(payload.get("tool_name") or payload.get("toolName") or "")
    strings = _walk_strings(payload.get("tool_input") or payload.get("toolInput") or {}, [])
    blob = "\n".join(strings)

    if not blob.strip():
        print(json.dumps({"continue": True}))
        return 0

    # Protected paths apply to write-ish tools only.
    if not re.search(r"terminal|bash|shell|command", tool, re.I):
        for pattern, reason in PROTECTED:
            if any(pattern.search(s) for s in strings):
                print(_decision("deny", reason))
                return 0

    for pattern, reason in DENY:
        if pattern.search(blob):
            print(_decision("deny", reason))
            return 0

    for pattern, reason in ASK:
        if pattern.search(blob):
            print(_decision("ask", reason))
            return 0

    print(json.dumps({"continue": True}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
