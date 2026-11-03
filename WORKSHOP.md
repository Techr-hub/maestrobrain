# Build Your Brain: facilitator guide

A run-sheet for the hands-on part of the 2.5-hour workshop. Participants leave with a working second brain on their own laptop, connected to Claude Desktop and open in Obsidian.

**Install command to put on the slide:**

- Mac (Terminal): `curl -fsSL https://raw.githubusercontent.com/Techr-hub/maestrobrain/main/install.sh | bash`
- Windows (PowerShell): `irm https://raw.githubusercontent.com/Techr-hub/maestrobrain/main/install.ps1 | iex`

ZIP fallback: https://github.com/Techr-hub/maestrobrain/archive/refs/heads/main.zip

## Before the day (send to participants)

1. Install **Node.js LTS** from nodejs.org (18.17 or newer).
2. Install **Claude Desktop** (claude.ai/download) and sign in.
3. Install **Obsidian** (obsidian.md/download).
4. Use **Chrome or Edge** for the dashboard (needed for voice).
5. Optional: run the install command in advance. It's small and needs no `npm install`, so conference Wi-Fi is fine.

Facilitator check: run `npm test` on a clean machine the day before. It should print `80 passed, 0 failed`.

---

## Agenda map

| Block | Time | Maestro moment |
|---|---|---|
| Intro | 10 min | Show the dashboard on the projector: brain map, feed, say "Hey Maestro, brief me on my day" |
| The 5 pillars | 25 min | Point at each pillar live: chat/voice (1), Settings → AI engine (2), MCP Connections (3), Knowledge page / Obsidian (4), Memory notes + "remember that…" (5) |
| Use cases | 35 min | Install each pack on screen and run its challenge (below) |
| **Build Your Brain** | 45 min | Everyone installs and customises (below) |
| ClarityMode | separate | Not part of Maestro |
| Wrap-up | 10 min | Next steps: go live with one real connector this week |

---

## Build Your Brain (45 min)

### 1. Download and start (10 min)
- Paste the one-line install command for your OS (on the slide). It downloads, installs to `~/maestro-brain` and starts Maestro.
- ZIP users on **Mac**: macOS blocks double-clicking downloaded scripts. In Terminal type `bash ` and drag `Start Maestro.command` in, then Enter. **Windows**: double-click `Start Maestro.bat` (SmartScreen: *More info → Run anyway*).
- The browser opens `http://localhost:4141`. Complete onboarding. First choice: **Load demo data** (recommended for the workshop) or **Set up my real connections** (starts empty and walks through connecting calendars, email, messages and calls). Then knowledge base, name, role pack and Connect to Claude Desktop.
- ✅ Checkpoint: everyone sees the brain map and a full Intelligence Feed.

### 2. Connect Claude Desktop (10 min)
- Fully quit Claude Desktop (Mac: ⌘Q; Windows: right-click the tray icon → Quit) and reopen.
- In a new chat, check **+ → Connectors** shows **maestro**.
- Ask: *"Use Maestro to brief me on my day."* then *"@Product what's blocking Sprint 24?"* (from the + menu, pick the **agent-product** prompt).
- ✅ Checkpoint: Claude quotes notes like [[Sprint 24]].

### 3. Open the vault in Obsidian (5 min)
- Obsidian → **Open folder as vault** → `maestro-brain/vault`.
- Open **Graph view**: it's the same brain as the dashboard map.
- Edit `Memory/About Me.md` with real details. Ask the dashboard "What do you know about me?"

### 4. Customise (15 min) — pick at least two
- **Profile:** flip Business ↔ Personal at the top and watch the feed and map change.
- **Make an agent:** Agents → New agent (or ask Claude: *"Create a Maestro agent called Coach that…"*). Then `@Coach` in chat.
- **Make a skill:** Skills & Packs → New skill, add triggers. Then **Download all (.zip)** under Claude Skills and upload to Claude → Settings → Capabilities → Skills.
- **Go live with one source:** paste your Google Calendar secret iCal address (see `docs/CONNECTORS.md`).
- **Change the engine:** Settings → AI engine → Claude with an API key, or Hermes via Ollama.
- **Voice:** press the mic (Alt+V). The brain core in the map pulses while you talk and spins while Maestro answers. Try hands-free mode.

### 5. Share (5 min)
Two or three volunteers screen-share their brain and one thing they built.

---

## The three challenges

Install the pack on Skills & Packs, then paste the challenge into chat (or press **Try the challenge** on the pack card). All work offline with the demo brain; with Claude connected the answers get richer.

| Pack | Agent | Challenge |
|---|---|---|
| Product Manager | @Product | *Review my current sprint, identify blockers, and prepare an update for stakeholders.* |
| Design & Marketing | @Design | *Review the latest design feedback and identify changes needed before developer handoff.* |
| Entrepreneur & Builder | @Dev | *Review open pull requests and issues, then prepare a technical status report.* |

Stretch goal for fast finishers: ask the agent to **save the answer to the vault**, then find it in Obsidian.

---

## Troubleshooting at the table

| Symptom | Fix |
|---|---|
| `node` not found | Install Node LTS, then open a **new** terminal / re-run the starter |
| Mac won't open `Start Maestro.command` | Use the one-line installer, or `bash ` + drag the file into Terminal. For double-click: System Settings → Privacy & Security → Open Anyway |
| Mac starter opens and closes | Run in Terminal: `cd ~/maestro-brain && npm start` |
| Windows: Claude Desktop from Microsoft Store | Maestro writes both config locations automatically; quit and reopen Claude |
| Claude has no *maestro* | Run `npm run connect-claude`, then fully quit Claude. Check Settings → Developer for logs |
| Mic does nothing | Chrome/Edge only; click the 🔒 in the address bar → allow microphone |
| Port in use | Maestro picks the next port; read the URL in the terminal |
| Messy demo after playing | Settings → Demo → Reset demo feed |

## Resetting a machine after the workshop
Settings and connections are also saved in your knowledge base (`.maestro/settings.json`) and in `~/.maestro/`, so unzipping a newer version keeps them. To forget settings, keys and chat history, delete the `data/` folder, the `.maestro` folder in your vault and `~/.maestro`. The vault is just Markdown: keep it, or delete the folder.
