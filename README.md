# becise-skills

Claude Code plugin marketplace. Hosts plugins (mostly skills) installable via `/plugin marketplace add`.

## Add this marketplace

This repo is private — auth required. Same commands work in Claude Code CLI, the Claude Code panel inside Claude Desktop, and the VS Code/JetBrains extensions (all share `~/.claude/` config).

**SSH** (if your key is already set up on GitHub):
```bash
/plugin marketplace add git@github.com:becise/becise-skills.git
```

**HTTPS** (needs a git credential helper already configured, e.g. via `gh auth login`):
```bash
/plugin marketplace add https://github.com/becise/becise-skills.git
```

**Local path** (no auth, no auto-update — good for solo/local use):
```bash
/plugin marketplace add /absolute/path/to/becise-skills
```

Then install a plugin:

```bash
/plugin install example-skill@becise-skills
```

Pick up new/updated skills later with:

```bash
/plugin marketplace update becise-skills
```

## Repo layout

```
.claude-plugin/marketplace.json   # marketplace manifest — lists every plugin
plugins/
  <plugin-name>/
    .claude-plugin/plugin.json    # plugin manifest
    skills/
      <skill-name>/
        SKILL.md                 # skill definition
```

## Adding a new skill

1. **Pick a plugin, or make one.** Skills live inside plugins. If an existing plugin fits the topic, add your skill there. Otherwise create a new plugin folder:

   ```bash
   mkdir -p plugins/<plugin-name>/.claude-plugin plugins/<plugin-name>/skills
   ```

   and add `plugins/<plugin-name>/.claude-plugin/plugin.json`:

   ```json
   {
     "name": "<plugin-name>",
     "description": "What this plugin is for",
     "version": "0.1.0"
   }
   ```

2. **Add the skill folder and SKILL.md:**

   ```bash
   mkdir -p plugins/<plugin-name>/skills/<skill-name>
   ```

   `plugins/<plugin-name>/skills/<skill-name>/SKILL.md`:

   ```markdown
   ---
   name: <skill-name>
   description: One line — what it does AND when Claude should trigger it. This is the only thing Claude sees before deciding to use the skill, so be specific.
   ---

   # <Skill Title>

   Instructions for Claude to follow when this skill is invoked.
   ```

   Any extra files the skill needs (scripts, templates, reference docs) go alongside `SKILL.md` in the same folder — reference them with relative paths.

3. **Register a new plugin in the marketplace.** If you created a new plugin folder, add it to `.claude-plugin/marketplace.json`:

   ```json
   {
     "name": "<plugin-name>",
     "source": "./plugins/<plugin-name>",
     "description": "What this plugin is for"
   }
   ```

   (Adding a skill to an *existing* plugin needs no marketplace changes — the plugin already picks up everything under its `skills/` folder.)

4. **Test locally** before pushing:

   ```bash
   /plugin marketplace add /absolute/path/to/becise-skills
   /plugin install <plugin-name>@becise-skills
   ```

   Then try the skill's trigger phrase in a session and confirm it fires.

5. **Commit and push.** Anyone with the marketplace already added picks up new/updated skills via `/plugin marketplace update becise-skills`.

## Removing the example

`plugins/example-skill/` is a template — delete it (and its entry in `marketplace.json`) once real plugins exist.
