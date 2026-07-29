# becise-skills marketplace

This repo is a Claude Code plugin marketplace (`.claude-plugin/marketplace.json` → `plugins/*`).

## Versioning rule

Claude Desktop/Code detect plugin updates by comparing `version` in each plugin's `.claude-plugin/plugin.json` against what's installed. **Any commit that changes files under `plugins/<name>/` (skills, agents, commands, docs) must bump that plugin's `version` (semver: MAJOR.MINOR.PATCH) in the same commit.** Skipping the bump means the update exists in git but installed clients won't see it as available.

Standard semver increment rules:

- **PATCH** (`0.1.0` → `0.1.1`): bug fixes, wording/doc tweaks, typo fixes, internal cleanup — no change to how a skill/command/agent is invoked or behaves from the user's perspective.
- **MINOR** (`0.1.1` → `0.2.0`): new skill/command/agent added, new capability or option added to an existing one, backward-compatible behavior change (existing usage still works).
- **MAJOR** (`0.2.0` → `1.0.0`): breaking change — a skill/command/agent renamed or removed, trigger/args/output format changed in a way that breaks existing usage, or (for the `1.0.0` bump specifically) first stable release.

Default to PATCH when unsure. Ask instead of guessing only if a change is ambiguously breaking.
