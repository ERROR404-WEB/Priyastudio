# Agent skills

Two folders, two different lifecycles.

| Folder | Contents | Git |
|---|---|---|
| `.github/skills/` | Skills written for Z-CIP | Committed and reviewed |
| `.github/skills-external/` | Third-party skills installed from the internet | Ignored |

## `.github/skills/` — ours

Skills here encode Z-CIP-specific procedure: our migration rules, our entity registry gate, our
permission model. They are part of the codebase and change through pull requests like any other
file. Current set:

- `add-a-domain-entity` — model, schema, repository, service, router, migration, tests
- `create-a-migration` — idempotent, reversible Alembic migrations

Use the `writing-skills` skill when adding one.

## `.github/skills-external/` — vendored

The Superpowers set (`brainstorming`, `writing-plans`, `test-driven-development`,
`systematic-debugging`, and the rest) plus `ui-ux-pro-max`. These are upstream copies with no local
edits, so committing them would put someone else's code under our review process and duplicate it
across repos.

The folder is gitignored. Install it per machine and re-install to upgrade. If you edit one of these
skills, the change belongs in `.github/skills/` as a new skill instead — local edits here are lost
on the next upgrade.

## Discovery

VS Code finds `.github/skills/` by default. `.github/skills-external/` is registered in
`.vscode/settings.json` under `chat.agentSkillsLocations`.

`chat.agentSkillsLocations` is window-scoped, so a folder's `.vscode/settings.json` only takes
effect when that folder is opened on its own. In a multi-root workspace, put the same entry in your
**user** settings — relative paths there resolve inside every workspace folder.
