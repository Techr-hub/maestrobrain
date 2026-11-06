# Two-way calendar sync

With two-way sync on, anything you change in Maestro also changes in the real calendar: editing an event from its ⋮ menu, deleting it, or creating one ("Hey Maestro, create a meeting tomorrow at 2pm"). Guests get the usual update emails.

| Calendar | How Maestro writes to it | What you do |
| --- | --- | --- |
| iCloud (Apple Calendar) | CalDAV | On the **iCalendar** card, add your Apple ID and an app-specific password (appleid.apple.com → Sign-In and Security → App-Specific Passwords). |
| Google Calendar | Google Calendar API | On the **Google Calendar** card, click **Sign in with Google**. |
| Outlook / Microsoft 365 | Microsoft Graph | On the **Outlook / Microsoft 365** card, click **Sign in with Microsoft** and type the code it shows. |
| Calendly | Calendly API (read and cancel only) | Calendly does not let apps change a booking. Delete cancels it, and Calendly emails the invitee. To move a booking, the invitee uses their reschedule link. |

Sign-in tokens are stored only on your computer (`data/config.json`) and never sent to the browser. **Sign out** on the card removes them.

## One-time setup: the OAuth apps

Google and Microsoft only let an app sign you in after the app is registered. Whoever ships the kit does this once, then puts the IDs in the cards (or in `data/config.json` under `oauth`, or in the environment variables `MAESTRO_GOOGLE_CLIENT_ID`, `MAESTRO_GOOGLE_CLIENT_SECRET` and `MAESTRO_MS_CLIENT_ID`). Everyone using the kit can then just click **Sign in**.

### Google (about 10 minutes)

1. Go to <https://console.cloud.google.com/> and create a project, for example "Maestro".
2. **APIs & Services → Library**: search for **Google Calendar API** and click **Enable**.
3. **APIs & Services → OAuth consent screen**: choose **External**, fill in the app name and your email. Under **Scopes** add `.../auth/calendar`. Under **Test users** add the Google accounts that will sign in (up to 100 while the app is in testing).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**: application type **Desktop app**. Copy the **Client ID** and **Client secret**.
5. In Maestro, open the Google Calendar card, open **Set up once**, paste both, and click **Sign in with Google**.

While the app is in testing, Google shows a "Google hasn't verified this app" screen: click **Continue**. To remove that screen and the 100-user limit, submit the app for verification in the consent screen settings (the calendar scope needs Google's review, which can take a few weeks).

A desktop-app client accepts Maestro's address (`http://localhost:<port>/oauth/google`) automatically, so no redirect URL needs to be added.

### Microsoft (about 5 minutes)

1. Go to <https://portal.azure.com/> → **Microsoft Entra ID → App registrations → New registration**.
2. Name it "Maestro". Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**. No redirect URI. Click **Register**.
3. Copy the **Application (client) ID**.
4. **Authentication** → **Advanced settings** → set **Allow public client flows** to **Yes** → **Save**.
5. **API permissions → Add a permission → Microsoft Graph → Delegated**: add `Calendars.ReadWrite`, `User.Read` and `offline_access`.
6. In Maestro, open the Outlook card, open **Set up once**, paste the client ID, and click **Sign in with Microsoft**. Go to the link it shows and type the code.

Some work and school accounts only allow apps an admin has approved. If sign-in says approval is needed, ask your IT admin to grant consent for the app.

## What changes once you are signed in

- Google and Outlook events are read through their APIs every minute, so new events, changes and cancellations show in the feed within a minute (the iCal link is no longer needed).
- The ⋮ menu on an event card edits or deletes the event in the real calendar. For a repeating event, an edit changes just that date; delete asks "Just this one" or "Every date".
- "Which calendar?" when creating an event lists each Google and Outlook calendar you can write to.
- Calendars that are shared with you as view-only can't be changed. Maestro says so, and keeps your change in Maestro only.
