# Connecting your real accounts

Click the blue **Connect** button on a card to connect it; connected cards show a green **Connected** button, which opens the settings (including **Disconnect**). For Gmail and the other Claude-only connectors, connect them in Claude Desktop and then choose **I connected it in Claude Desktop**.

Every connector starts in **demo mode**, so the brain is full from minute one. When you're ready, open **MCP Connections**, pick a source, choose **Connect live**, and follow the steps below. Live items replace that source's demo items in the Intelligence Feed.

Maestro has two places where a connection can be live:

- **In the dashboard:** Maestro pulls the data itself (calendars via ICS links, Slack, Twilio) and turns it into feed cards. Credentials are stored only in `data/config.json` on your computer.
- **In Claude Desktop:** Claude's own connectors (Settings → Connectors) or an MCP server. Claude uses them alongside the Maestro MCP server, so it can read your mail with your memory and notes as context.

You can use both at once. Tokens are never written into the vault.

---

## Foundation connectors (every brain)

### iCalendar (Apple iCloud or any .ics feed)
1. Apple Calendar (Mac): right-click the calendar → **Share Calendar** → tick **Public Calendar** → copy the link. On iCloud.com: Calendar → share icon → **Public Calendar**.
2. In Maestro: MCP Connections → **iCalendar** → Connect live → paste the link (`webcal://` is fine). Have more than one calendar (work, family, shared)? Click **Add another calendar** for each link, then **Connect**. Open the card again any time to see, edit or remove the saved links.
3. Events appear on the Calendar page, including repeating meetings. Maestro refreshes every 10 minutes.

> A public link can be read by anyone who has it. Keep it private, or make a separate calendar for the brain.

### Creating events ("Hey Maestro, create a meeting tomorrow at 2pm with John")
Maestro asks for anything missing (day, time, length, topic, which calendar), then creates the event.
- **iCloud (and any CalDAV calendar: Fastmail, Nextcloud…):** on the iCalendar card, also enter your Apple ID and an **app-specific password** (appleid.apple.com → Sign-In and Security → App-Specific Passwords). Maestro finds your calendars and can write to any of them. For other CalDAV servers, fill in the server address too.
- **Google Calendar and Outlook** only allow writing through a sign-in app (OAuth). Connect them in Claude Desktop (Settings → Connectors) and ask Claude there; Claude can use Maestro's `create_event` tool or the Google/Microsoft connector.
- Without any of these, events go to your **Maestro calendar**. It shows everywhere in Maestro, and Apple Calendar or Outlook on the same computer can subscribe to `http://localhost:4141/calendar.ics`.

### New events in the feed
Maestro checks every live calendar once a minute. New, moved and cancelled events appear in the Intelligence Feed (the first check only takes a snapshot, so connecting doesn't flood the feed). Calendly bookings are labelled **Booked through Calendly**.
> iCloud and Calendly show changes within a minute or two. Google's secret iCal address is refreshed by Google itself and can lag by up to several hours; for instant Google updates, connect Calendly (if bookings come from there) or use Claude Desktop's Google Calendar connector.

### Calendly
1. calendly.com → **Integrations & apps** → **API and webhooks** → **Personal access tokens** → Generate new token.
2. In Maestro: **Calendly** → Connect live → paste the token → **Connect**.
3. New bookings appear in the feed within a minute, with the invitee's name, and on the Calendar page.

### Google Calendar
1. Google Calendar on the web → ⚙ **Settings** → choose your calendar under *Settings for my calendars* → **Integrate calendar** → copy **Secret address in iCal format**.
2. In Maestro: **Google Calendar** → Connect live → paste it (use **Add another calendar** for each extra calendar) → **Connect**.
3. Optional, for creating events from Claude: Claude Desktop → Settings → Connectors → **Google Calendar**.

### Outlook / Microsoft 365
1. Calendar: Outlook on the web → ⚙ Settings → Calendar → **Shared calendars** → **Publish a calendar** → choose *Can view all details* → **Publish** → copy the **ICS** link. Paste it into Maestro (Outlook → Connect live).
2. Mail: Claude Desktop → Settings → Connectors → **Microsoft 365**. (Your organisation's admin may need to allow it.)

### Gmail
Claude Desktop → Settings → Connectors → **Gmail**. Claude can then search, summarise and draft mail. Ask: *"Use Maestro and Gmail to triage my inbox."* The dashboard keeps showing demo email for Gmail.

### Email (IMAP / other: iCloud Mail, Fastmail, company mail)
Add an IMAP email MCP server to Claude Desktop. Several open-source ones exist; pick one you trust, and use an **app-specific password**, not your main password. The entry goes in `claude_desktop_config.json` next to `maestro`, for example:

```json
"email": {
  "command": "npx",
  "args": ["-y", "<imap-mcp-package>"],
  "env": { "IMAP_HOST": "imap.mail.me.com", "IMAP_USER": "you@icloud.com", "IMAP_PASSWORD": "app-specific-password" }
}
```

Check the package's README for the exact variable names.

### Slack
1. Go to **api.slack.com/apps** → **Create New App** → *From scratch* → choose your workspace.
2. **OAuth & Permissions** → *Bot Token Scopes* → add `channels:history`, `channels:read`, `users:read` (add `groups:history` for private channels).
3. **Install to Workspace** → copy the **Bot User OAuth Token** (`xoxb-…`).
4. In Slack, invite the bot to each channel: `/invite @YourApp`. Copy channel IDs (channel name → *View channel details* → bottom of the About tab).
5. In Maestro: **Slack** → Connect live → paste the token and channel IDs (comma separated) → **Connect**.
6. Optional: Claude Desktop → Settings → Connectors → **Slack**, so Claude can search and post.

### Text messages and calls (Twilio)
1. Sign up at **twilio.com** and buy a phone number (a trial account works for testing).
2. Console home → copy **Account SID** and **Auth token**.
3. In Maestro: **Text messages (Twilio)** and/or **Calls (Twilio)** → Connect live → paste the SID, token and your Twilio number (`+15551234567`) → **Connect**.
4. Maestro checks for new inbound messages and calls every 2 minutes. Missed calls become CALL cards with a "Call back" action.

> Your personal phone's iMessage/SMS can't be read by any app directly. Forward texts to your Twilio number, or give contacts the Twilio number for brain-tracked conversations.

---

## Role pack connectors

These are live inside Claude Desktop. Install the pack (Skills & Packs page) for demo data, then connect the real tool in Claude Desktop → Settings → Connectors.

| Connector | Pack | In Claude Desktop |
|---|---|---|
| Linear | PM, Design, Builder | Connectors → Linear (or remote MCP `https://mcp.linear.app/mcp`) |
| Jira / Confluence | PM, Builder | Connectors → Atlassian |
| Notion | PM, Design | Connectors → Notion |
| Figma | Design | Connectors → Figma |
| Google Drive | Design | Connectors → Google Drive |
| GitHub | Builder | Connectors → GitHub |
| Docs | Builder | Your docs platform's connector or MCP server |

---

## Writing to the feed from Claude

Anything Claude saves with Maestro's `write_note` or `log_decision` tools also shows up in the dashboard feed straight away. A good habit: *"Summarise my unread Gmail and save the summary to Maestro."*

## Troubleshooting

| Problem | Fix |
|---|---|
| "Test failed: 404" on a calendar | The link isn't public or was regenerated. Copy it again |
| Slack `not_in_channel` | Invite the bot to the channel with `/invite @YourApp` |
| Slack `missing_scope` | Add the scope, then **reinstall** the app and copy the new token |
| Twilio `20003` | Wrong SID/token pair, or you used a test credential |
| Claude doesn't use a connector | Turn it on in the chat's **+ → Connectors** menu, and mention it: "using Gmail…" |
