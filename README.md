# 🧱 Kidex

A voice-first coding buddy for kids. They pick what they want to do, press space, and talk. Kidex (Claude underneath) asks a couple of questions with big buttons, reads its plan out loud and waits for a 👍. Then it builds the thing, tests it, and says what it made.

```
 🧱 Kidex · Web toys

 🧒 en robot der danser
 🤖 Sejt, en dansende robot! Hvilken musik skal den danse til?

 ╔══════════════════╗ ╭─────────────────╮ ╭───────────────╮ ╭───────────────────╮
 ║  1  🎵 Glad pop  ║ │  2  🥁 Trommer  │ │  3  🎹 Disco  │ │  4  🤖 Robot-bip  │
 ╚══════════════════╝ ╰─────────────────╯ ╰───────────────╯ ╰───────────────────╯

  SPACE  🎤 snak   T  ⌨️  skriv   ESC  🏠 tilbage
```

Kidex knows nothing about any particular project. A project plugs in with a `kidex.json` (its buttons, its test command, and what Claude may run) and its usual `CLAUDE.md`. Claude follows that file just as it would for a grown-up.

## Setup (macOS)

```bash
brew install ffmpeg whisper-cpp
npm install
node bin/kidex.mjs setup     # downloads the speech model (~470 MB) to ~/.kidex
node bin/kidex.mjs doctor    # checks the mic, speech, and voices
```

Kidex runs Claude through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk), which uses your Claude Code login or `ANTHROPIC_API_KEY`.

Speech never leaves the machine: [whisper.cpp](https://github.com/ggml-org/whisper.cpp) turns talking into text, and macOS `say` talks back. For Danish, install the "Sara" voice under System Settings → Accessibility → Spoken Content → System voice → Manage voices. The first time a kid talks, macOS asks whether the terminal may use the microphone.

## Use

```bash
node bin/kidex.mjs path/to/project
```

| Key | |
| --- | --- |
| `SPACE` | start talking, `SPACE` again when done |
| `1`–`4`, arrows, `ENTER` | pick a button |
| `Y` / `N` | yes or no to the plan |
| `T` | type instead of talking |
| `ESC` | back to the start |
| `Q` | quit (on the start screen) |

To try it without a project, use `examples/web-toys`: kids make small browser toys there.

## Hook up a project

Put a `kidex.json` in the project's folder:

```jsonc
{
  "name": "Our Minecraft mods",
  "language": "auto",                // "da", "en", or "auto" (follow the kid)
  "instructions": "Mods live in addons/. ...",   // added to Claude's prompt
  "check": "./mc test {mod}",        // Claude must get this passing before "done"
  "allow": ["npm run new", "./mc test", "./mc kit"],   // commands Claude may run after the 👍
  "deny": ["./mc restart", "server/data/"],            // commands or folders, never
  "budgetUsd": 3,                    // per session
  "model": "claude-opus-5-5",
  "effort": "medium",
  "voices": { "da": "Sara", "en": "Samantha" },
  "git": { "branch": "kidex/{date}", "commit": true },  // optional: work on a branch, commit at the end
  "actions": [
    { "id": "new", "emoji": "✨", "label": { "en": "Make a mod", "da": "Lav et mod" }, "prompt": "Make a new mod." },
    { "id": "change", "emoji": "🔧", "label": "Change a mod", "pick": "addons/*", "prompt": "Change the mod in addons/{pick}." },
    { "id": "try", "emoji": "🎮", "label": "Try a mod", "pick": "addons/*", "run": "./mc kit {pick}" }
  ]
}
```

- `pick` first shows the folders matching `dir/*` as buttons, and `{pick}` is replaced by the chosen one.
- `run` runs a plain command without Claude, e.g. to open or play something.

Without a `kidex.json`, Kidex shows three general buttons and Claude may only look, not run anything.

## Safety

Kids drive an agent that can change files, so Kidex checks every tool call itself, in a `PreToolUse` hook that applies even when the project's own Claude settings allow more ([`src/guard.mjs`](src/guard.mjs)):

- **Nothing changes before the 👍.** Until the kid approves the plan, Claude can only read files and run look-only commands (`ls`, `cat`, `git status`, …).
- **Only the project.** Reading and writing stay inside the project folder, away from `.git/`, `.env`, `.claude/`, keys, and anything in `deny`.
- **Only listed commands.** After the 👍, Claude may run the `allow` prefixes and look-only commands. Every part of `a && b | c` must be allowed, and `$(…)`, backticks, and `>` redirects are refused.
- **Never:** `git push`/`commit`/`reset`/`checkout`, `sudo`, `curl`, `ssh`, `docker`, `kill`, web search and web fetch, whatever `allow` says.
- **A budget.** Each session stops at `budgetUsd`.

That keeps a kid from wrecking things by accident. It is not a sandbox against someone determined: an allowed command like `npm run x` runs whatever that script does. Only allow commands you trust.

## Without a screen

`kidex run` plays a session with no screen. It answers each question with the first choice and says yes to the plan. Handy for checking that a project's `kidex.json` and `CLAUDE.md` work:

```bash
node bin/kidex.mjs run examples/web-toys --say "a button that makes a cat sound" --action new
```

It prints one JSON event per line and exits 0 if Claude finished with `all_done`.

## How it works

| File | |
| --- | --- |
| `src/ui.mjs` | the screen ([Ink](https://github.com/vadimdemedes/ink)) |
| `src/session.mjs` | one conversation: Claude Agent SDK `query()` with Kidex's own tools (`ask_kid`, `show_plan`, `tell_kid`, `draw_picture`, `all_done`). `draw_picture` writes pixel art to a PNG, so Claude never needs to run a script to make a picture. |
| `src/guard.mjs` | what Claude may do |
| `src/voice.mjs` | ffmpeg + whisper.cpp in, `say` out |
| `src/pictures.mjs` | draws the PNGs Claude made, right in the terminal |
| `src/prompt.mjs` | how Claude should talk to kids |
