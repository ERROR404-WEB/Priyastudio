---
description: "Use when adding, upgrading, or pinning a Python dependency, or when a vulnerability scan fails. Covers checking the registry for the current stable release, the no-high-or-critical rule, and what to do when a vulnerability has no fix."
applyTo: "pyproject.toml,uv.lock,Dockerfile"
---

# Dependencies

Two rules, both enforced in CI:

1. **Check the registry before you pin.** Never invent a version from memory — model training data goes
   stale, and a version that does not exist fails the install.
2. **No high or critical vulnerability ships.** Not in a direct dependency, not in a transitive one.

## Before adding or upgrading

Look up what actually exists, right now:

```bash
uv pip index versions fastapi            # published versions, newest first
uv add fastapi                           # resolves to the current release and records the floor
uv add --upgrade-package fastapi fastapi # move an existing pin to the newest compatible release
uv run --with pip-audit pip-audit        # scan before you commit to it
```

There is **no `@latest` suffix in `uv`** — `uv add "fastapi@latest"` is parsed as a local path and
fails confusingly. Plain `uv add <name>` already takes the newest compatible release.

To inspect what resolved, or trace a transitive package:

```bash
uv pip list                              # what the lockfile resolved to
uv run --with pipdeptree pipdeptree -r -p ecdsa   # what pulls a transitive package in
```

Prefer the current stable release. Do not adopt a pre-release, release candidate, or beta without a
stated reason — "latest" means latest *stable*.

Pin with a floor (`>=`), not an equality. `uv.lock` is the authoritative record of what actually
resolved; the floor in `pyproject.toml` records the minimum the code needs. The lockfile is
committed, and CI installs with `uv sync --frozen`.

## The vulnerability gate

```bash
uv run --with pip-audit pip-audit
```

- **Critical or high → does not merge.** Upgrade to a fixed version.
- **Moderate or low →** upgrade if a fix exists. If not, record it in the PR with the reason.

## When there is no fix

Sometimes a package is vulnerable and upstream will not fix it. A "won't fix" is still a finding —
you own the decision, so make it explicitly, in this order:

1. **Replace the package.** Usually the right answer, and usually cheaper than it looks when the
   surface is small and well tested.
2. **Remove it.** Check whether it is genuinely needed, or a transitive dependency of something that
   can be dropped.
3. **Accept it, in writing.** Only when the vulnerable code path is provably unreachable from our
   usage. Record what the vulnerability is, why it cannot reach us, and what would change that.
   Add it to the ignore list with a comment naming the advisory — never silence the whole scan.

Reaching for step 3 first is how a known vulnerability lives in a contracts platform for a year.

**Worked example.** `python-jose` depends on `ecdsa`, which carries an unfixable timing-attack
advisory — the maintainers consider side-channel resistance out of scope for a pure-Python
implementation, so no fix version will ever appear. We validate Entra tokens with RS256, so the
ECDSA path is not one we use, which makes step 3 tempting. We took step 1 instead and moved to
`PyJWT[crypto]`, which uses `cryptography` and pulls no `ecdsa`. The vulnerability is gone rather
than argued about, and the argument does not need re-making every time someone runs the scanner.

## Replacing a security library: prove the options still bind

When you swap one library for another, **a configuration option that no longer exists usually fails
silently.** The call still runs, the tests still pass, and the guarantee is gone.

That migration is the example. `python-jose` spells required claims
`options={"require_exp": True}`; PyJWT spells it `options={"require": ["exp"]}`. PyJWT ignores
unknown keys without complaint, so carrying the old spelling across left a validator that accepted
**a token with no expiry at all** — and every one of the nine existing tests stayed green while it
did.

So, for any security-relevant option in a replaced library: write a test that fails without the
option, watch it fail, then apply the option and watch it pass. A test that never failed proves
nothing about the option it claims to cover.

## Adding a dependency at all

Every dependency is code we are responsible for and an attack surface we inherit.

- Prefer the standard library. Prefer a dependency we already have over a new one.
- A package that handles **tokens, cryptography, file parsing, or user input** needs explicit review.
  Those are where supply-chain problems land.
- Check it is maintained: a recent release, an open issue tracker, more than one contributor.
- Never add a dependency to work around a problem in our own code.
